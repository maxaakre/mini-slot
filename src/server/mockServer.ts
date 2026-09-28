import { BET_LEVELS, BONUS_BUY_COST, FREE_SPINS } from '../math/config';
import { playSpin, retriggerSpins, type SpinOutcome } from '../math/engine';
import { createRng, type Rng } from '../math/rng';
import {
  ServerError,
  type FreeSpinsState,
  type GameApi,
  type RoundRequest,
  type RoundResponse,
  type Session,
} from './protocol';

/**
 * In-browser stand-in for a real game server.
 *
 * The client never decides an outcome. It sends a request, the server draws
 * the result and settles the balance, and the client only presents it —
 * the same split a regulated game needs.
 */

export interface MockServerOptions {
  seed: number;
  /** Cents. */
  balance: number;
  latencyMs?: number;
  /**
   * Chance (0–1) that the response is lost after the round is settled.
   * Used to show that client retries are safe.
   */
  failureRate?: number;
}

const IDEMPOTENCY_CACHE_SIZE = 50;

interface SettledRound {
  request: RoundRequest;
  response: RoundResponse;
}

export class MockServer implements GameApi {
  private balance: number;
  private roundId = 0;
  private freeSpins: FreeSpinsState | null = null;
  private readonly rng: Rng;
  // Separate stream so injected failures never change game outcomes.
  private readonly networkRng: Rng;
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private readonly rounds = new Map<string, SettledRound>();

  constructor(options: MockServerOptions) {
    this.rng = createRng(options.seed);
    this.networkRng = createRng(options.seed ^ 0x9e3779b9);
    this.balance = options.balance;
    this.latencyMs = options.latencyMs ?? 0;
    this.failureRate = options.failureRate ?? 0;
  }

  /** Initial state for a client that (re)connects, e.g. mid-bonus after a reload. */
  getSession(): Session {
    return { balance: this.balance, freeSpins: this.freeSpins && { ...this.freeSpins } };
  }

  async play(request: RoundRequest): Promise<RoundResponse> {
    await this.delay();

    const cached = this.rounds.get(request.requestId);
    if (cached && !sameRound(cached.request, request)) {
      // A retry must repeat the original request exactly.
      throw new ServerError('REQUEST_ID_REUSED', 'Request id was already used for a different round');
    }
    const response = cached?.response ?? this.settle(request);

    if (!cached) this.remember(request, response);

    if (this.networkRng.next() < this.failureRate) {
      // The round is settled, but the client never hears about it.
      throw new ServerError('NETWORK', 'Connection lost');
    }
    return structuredClone(response);
  }

  private settle(request: RoundRequest): RoundResponse {
    switch (request.type) {
      case 'spin':
        return this.settleSpin(request);
      case 'freeSpin':
        return this.settleFreeSpin(request);
      case 'buyBonus':
        return this.settleBonusBuy(request);
    }
  }

  private settleSpin(request: RoundRequest): RoundResponse {
    this.assertNoBonus();
    this.charge(request.bet, request.bet);

    const outcome = playSpin(this.rng, request.bet, 'base');
    this.balance += outcome.totalWin;

    if (outcome.freeSpinsAwarded > 0) {
      this.startBonus(request.bet, outcome.freeSpinsAwarded);
    }
    return this.response(request, request.bet, outcome, outcome.totalWin);
  }

  private settleFreeSpin(request: RoundRequest): RoundResponse {
    const bonus = this.freeSpins;
    if (!bonus || bonus.remaining <= 0) {
      throw new ServerError('NO_FREE_SPINS', 'No free spins left');
    }

    const outcome = playSpin(this.rng, bonus.bet, 'free');
    this.balance += outcome.totalWin;

    bonus.played++;
    bonus.remaining--;
    bonus.totalWin += outcome.totalWin;
    const added = retriggerSpins(bonus.total, outcome.freeSpinsAwarded);
    bonus.remaining += added;
    bonus.total += added;

    const response = this.response(request, 0, outcome, outcome.totalWin);
    if (bonus.remaining === 0) this.freeSpins = null;
    return response;
  }

  private settleBonusBuy(request: RoundRequest): RoundResponse {
    this.assertNoBonus();
    const cost = request.bet * BONUS_BUY_COST;
    this.charge(request.bet, cost);
    this.startBonus(request.bet, FREE_SPINS.awarded);
    return this.response(request, cost, null, 0);
  }

  private startBonus(bet: number, spins: number): void {
    this.freeSpins = {
      remaining: spins,
      played: 0,
      total: spins,
      multiplier: FREE_SPINS.winMultiplier,
      bet,
      totalWin: 0,
    };
  }

  private assertNoBonus(): void {
    if (this.freeSpins) {
      throw new ServerError('FREE_SPINS_ACTIVE', 'Finish the free spins first');
    }
  }

  private charge(bet: number, cost: number): void {
    if (!BET_LEVELS.includes(bet)) {
      throw new ServerError('INVALID_BET', `Bet ${bet} is not allowed`);
    }
    if (cost > this.balance) {
      throw new ServerError('INSUFFICIENT_FUNDS', 'Not enough balance');
    }
    this.balance -= cost;
  }

  private response(request: RoundRequest, cost: number, outcome: SpinOutcome | null, win: number): RoundResponse {
    return {
      requestId: request.requestId,
      roundId: ++this.roundId,
      type: request.type,
      cost,
      outcome,
      win,
      balance: this.balance,
      freeSpins: this.freeSpins && { ...this.freeSpins },
    };
  }

  private remember(request: RoundRequest, response: RoundResponse): void {
    this.rounds.set(request.requestId, { request: { ...request }, response });
    if (this.rounds.size > IDEMPOTENCY_CACHE_SIZE) {
      // Maps keep insertion order, so the first key is the oldest.
      const oldest = this.rounds.keys().next().value;
      if (oldest !== undefined) this.rounds.delete(oldest);
    }
  }

  private delay(): Promise<void> {
    if (this.latencyMs <= 0) return Promise.resolve();
    // Jitter makes loading states visible and realistic.
    const ms = this.latencyMs * (0.5 + this.networkRng.next());
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function sameRound(a: RoundRequest, b: RoundRequest): boolean {
  return a.type === b.type && a.bet === b.bet;
}
