import { BET_LEVELS, BONUS_BUY_COST } from '../math/config';
import { isBigWin, type Grid } from '../math/engine';
import { createRequestId, playWithRetry } from '../server/client';
import {
  ServerError,
  type FreeSpinsState,
  type GameApi,
  type RoundResponse,
  type RoundType,
  type ServerErrorCode,
  type Session,
} from '../server/protocol';
import { formatMoney } from './format';
import type { Clock, HudPort, PresenterPort, ReelsPort } from './ports';
import { StateMachine, type GameState } from './stateMachine';

export interface ControllerDeps {
  api: GameApi;
  /** Current server state, used on start and to reconcile after errors. */
  getSession: () => Session;
  reels: ReelsPort;
  presenter: PresenterPort;
  hud: HudPort;
  clock: Clock;
  initialGrid: Grid;
  turbo: boolean;
  reducedMotion: boolean;
}

/** Minimum spin time, so a fast server still gives a readable spin. */
const MIN_SPIN_MS = { normal: 450, turbo: 120 };
const FREE_SPIN_PAUSE_MS = { normal: 450, turbo: 150 };
const RETRY = { retries: 3, backoffMs: 250 };

const ERROR_MESSAGES: Record<ServerErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'Not enough balance for this bet',
  INVALID_BET: 'That bet is not available',
  FREE_SPINS_ACTIVE: 'Finish your free spins first',
  NO_FREE_SPINS: 'No free spins left',
  REQUEST_ID_REUSED: 'Something went wrong. Your balance is safe — please try again.',
  NETWORK: 'Connection problem. Your balance is safe — please try again.',
};

/**
 * Glue between the state machine, the server and the views.
 *
 * Rule of thumb: the server owns money and outcomes, the state machine owns
 * "what can happen now", the views own how it looks. The controller only
 * sequences them.
 */
export class GameController {
  private readonly fsm = new StateMachine();
  private balance: number;
  private betIndex = BET_LEVELS.indexOf(100);
  private freeSpins: FreeSpinsState | null;
  private lastGrid: Grid;
  private turbo: boolean;
  private skipRequested = false;
  private readonly sessionStart = Date.now();
  private readonly startBalance: number;

  constructor(private readonly deps: ControllerDeps) {
    const session = deps.getSession();
    this.balance = session.balance;
    this.startBalance = session.balance;
    this.freeSpins = session.freeSpins;
    this.lastGrid = deps.initialGrid;
    this.turbo = deps.turbo;

    this.fsm.subscribe(() => this.render());
    setInterval(() => this.renderSession(), 10_000);
    this.render();
    this.renderSession();

    // Reconnected mid-bonus (e.g. after a reload): carry on where we left off.
    if (this.freeSpins) this.scheduleFreeSpin();
  }

  get state(): GameState {
    return this.fsm.state;
  }

  private get bet(): number {
    return BET_LEVELS[this.betIndex]!;
  }

  /** The one big button: spin when idle, otherwise stop/skip. */
  press(): void {
    switch (this.fsm.state) {
      case 'idle':
        if (!this.freeSpins) this.startRound('spin');
        return;
      case 'spinning':
      case 'stopping':
        this.skipRequested = true;
        this.deps.reels.slam();
        return;
      case 'presenting':
        this.deps.presenter.skip();
        return;
      default:
        return;
    }
  }

  changeBet(direction: -1 | 1): void {
    if (this.fsm.state !== 'idle' || this.freeSpins) return;
    this.betIndex = Math.max(0, Math.min(BET_LEVELS.length - 1, this.betIndex + direction));
    this.render();
  }

  setTurbo(on: boolean): void {
    this.turbo = on;
  }

  async buyBonus(): Promise<void> {
    if (this.freeSpins || !this.fsm.send('BUY')) return;
    try {
      const response = await this.request('buyBonus');
      this.fsm.send('BOUGHT');
      if (response.freeSpins) this.deps.hud.announce(`Bought ${response.freeSpins.total} free spins`);
      this.scheduleFreeSpin(true);
    } catch (error) {
      this.fsm.send('FAIL');
      this.handleError(error);
    }
  }

  /**
   * Runs a round and turns any unexpected error into a recoverable one.
   * Without this, a throw during the presentation would leave the game
   * stuck mid-round.
   */
  private startRound(type: Extract<RoundType, 'spin' | 'freeSpin'>): void {
    this.playRound(type).catch((error: unknown) => {
      console.error(error);
      this.deps.presenter.skip();
      this.fsm.send('FAIL');
      this.handleError(error);
    });
  }

  private async playRound(type: Extract<RoundType, 'spin' | 'freeSpin'>): Promise<void> {
    if (!this.fsm.send('SPIN')) return;
    const { reels, presenter, hud, clock } = this.deps;

    this.skipRequested = false;
    hud.setWin(0);
    if (type === 'spin') {
      hud.hideMessage();
      // Show the stake leaving the balance right away; the server confirms it.
      hud.setBalance(this.balance - this.bet);
    }
    reels.startSpin();
    const minSpin = clock.wait(this.turbo ? MIN_SPIN_MS.turbo : MIN_SPIN_MS.normal);

    let response: RoundResponse;
    try {
      response = await this.request(type);
    } catch (error) {
      this.fsm.send('FAIL');
      await reels.stopOn(this.lastGrid, { turbo: true });
      this.handleError(error);
      return;
    }

    if (this.skipRequested) minSpin.finish();
    await minSpin.done;

    const outcome = response.outcome!;
    this.fsm.send('RESULT');
    await reels.stopOn(outcome.grid, { turbo: this.turbo || this.skipRequested });
    this.lastGrid = outcome.grid;
    this.fsm.send('STOPPED');

    // Free spins are measured against the bet that started the bonus.
    const bet = response.freeSpins?.bet ?? this.bet;
    await presenter.present(outcome, {
      bet,
      turbo: this.turbo,
      reducedMotion: this.deps.reducedMotion,
      onCount: (cents) => hud.setWin(cents),
    });
    hud.setWin(outcome.totalWin);
    hud.setBalance(this.balance);
    if (outcome.totalWin > 0) {
      const big = isBigWin(outcome.totalWin, bet) ? 'Big win! ' : '';
      hud.announce(`${big}You won ${formatMoney(outcome.totalWin)}`);
    }

    this.fsm.send('DONE');
    this.afterRound(response);
  }

  private afterRound(response: RoundResponse): void {
    const bonus = response.freeSpins;
    const { hud } = this.deps;
    this.renderSession();

    if (bonus && bonus.remaining > 0) {
      const started = response.type === 'spin';
      if (started) hud.announce(`${bonus.total} free spins triggered`);
      this.scheduleFreeSpin(started);
    } else if (response.type === 'freeSpin') {
      // That was the last free spin.
      const total = bonus?.totalWin ?? 0;
      hud.showMessage(`Free spins complete · Won ${formatMoney(total)}`, 'bonus', 4000);
      hud.announce(`Free spins complete. You won ${formatMoney(total)}`);
      this.deps.reels.setFreeSpins(false);
    }
  }

  private scheduleFreeSpin(intro = false): void {
    const bonus = this.freeSpins;
    if (!bonus) return;
    this.deps.reels.setFreeSpins(true);
    this.deps.hud.showMessage(
      intro
        ? `${bonus.total} FREE SPINS · All wins x${bonus.multiplier}`
        : `Free spin ${bonus.played + 1} / ${bonus.total} · x${bonus.multiplier} · Won ${formatMoney(bonus.totalWin)}`,
      'bonus',
    );
    const pause = intro ? 1500 : this.turbo ? FREE_SPIN_PAUSE_MS.turbo : FREE_SPIN_PAUSE_MS.normal;
    this.deps.clock.wait(pause).done.then(() => this.startFreeSpin());
  }

  private startFreeSpin(): void {
    if (!this.freeSpins) return;
    // Should always be idle here. If not, try again shortly rather than
    // leaving the bonus stuck.
    if (!this.fsm.can('SPIN')) {
      this.deps.clock.wait(200).done.then(() => this.startFreeSpin());
      return;
    }
    this.startRound('freeSpin');
  }

  private async request(type: RoundType): Promise<RoundResponse> {
    const response = await playWithRetry(this.deps.api, { requestId: createRequestId(), type, bet: this.bet }, RETRY);
    this.balance = response.balance;
    // The last free spin reports remaining 0: the bonus is over.
    this.freeSpins = response.freeSpins && response.freeSpins.remaining > 0 ? response.freeSpins : null;
    return response;
  }

  private handleError(error: unknown): void {
    const message = error instanceof ServerError ? ERROR_MESSAGES[error.code] : 'Something went wrong';
    this.deps.hud.showMessage(message, 'error', 5000);

    // The server is the source of truth: re-sync instead of guessing.
    const session = this.deps.getSession();
    this.balance = session.balance;
    this.freeSpins = session.freeSpins;
    this.deps.hud.setBalance(this.balance);
    this.fsm.send('DISMISS');
    // Resume the bonus after the player has had time to read the message.
    if (this.freeSpins) this.deps.clock.wait(2000).done.then(() => this.scheduleFreeSpin());
  }

  private render(): void {
    const { hud } = this.deps;
    const bonusCost = this.bet * BONUS_BUY_COST;
    hud.setBet(this.bet, bonusCost);
    if (this.fsm.state === 'idle') hud.setBalance(this.balance);
    hud.render({
      state: this.fsm.state,
      inFreeSpins: this.freeSpins !== null,
      canAffordSpin: this.balance >= this.bet,
      canAffordBonus: this.balance >= bonusCost,
    });
  }

  private renderOutOfBalance(): void {
    if (this.fsm.state !== 'idle' || this.freeSpins) return;
    if (this.balance < BET_LEVELS[0]!) {
      this.deps.hud.showMessage('Out of balance · Reload the page to start over', 'error');
    } else if (this.balance < this.bet) {
      this.deps.hud.showMessage('Lower your bet to keep playing', 'info');
    }
  }

  private renderSession(): void {
    const minutes = Math.floor((Date.now() - this.sessionStart) / 60_000);
    this.deps.hud.setSession(minutes, this.balance - this.startBalance);
    this.renderOutOfBalance();
  }
}
