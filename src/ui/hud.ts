import type { GameState } from '../game/stateMachine';

/**
 * HUD in plain DOM, not canvas: real buttons give keyboard support, focus
 * and screen reader labels for free, and text stays crisp at any scale.
 */

export interface HudCallbacks {
  onSpin: () => void;
  onBetChange: (direction: -1 | 1) => void;
  onTurboChange: (on: boolean) => void;
  onBuyBonus: () => void;
}

export interface HudView {
  state: GameState;
  inFreeSpins: boolean;
  canAffordSpin: boolean;
  canAffordBonus: boolean;
}

export const formatMoney = (cents: number): string =>
  (cents / 100).toLocaleString('sv-SE', { style: 'currency', currency: 'EUR' });

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export class Hud {
  private readonly balance = el('balance');
  private readonly bet = el('bet');
  private readonly win = el('win');
  private readonly spin = el<HTMLButtonElement>('spin');
  private readonly betDown = el<HTMLButtonElement>('bet-down');
  private readonly betUp = el<HTMLButtonElement>('bet-up');
  private readonly turbo = el<HTMLInputElement>('turbo');
  private readonly buy = el<HTMLButtonElement>('buy');
  private readonly message = el('message');
  private readonly session = el('session');
  private readonly announcer = el('announcer');
  private messageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(callbacks: HudCallbacks, turboOn: boolean) {
    this.spin.addEventListener('click', callbacks.onSpin);
    this.betDown.addEventListener('click', () => callbacks.onBetChange(-1));
    this.betUp.addEventListener('click', () => callbacks.onBetChange(1));
    this.buy.addEventListener('click', callbacks.onBuyBonus);
    this.turbo.checked = turboOn;
    this.turbo.addEventListener('change', () => callbacks.onTurboChange(this.turbo.checked));

    // Space always means spin / stop, like every slot. It must never click
    // whatever button has focus (e.g. Buy bonus after a mouse click).
    // Capture phase + preventDefault on both key events blocks the native click.
    const onSpace = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'keydown' && !event.repeat) callbacks.onSpin();
    };
    window.addEventListener('keydown', onSpace, { capture: true });
    window.addEventListener('keyup', onSpace, { capture: true });
  }

  setBalance(cents: number): void {
    this.balance.textContent = formatMoney(cents);
  }

  setBet(cents: number, bonusCost: number): void {
    this.bet.textContent = formatMoney(cents);
    this.buy.querySelector('.cost')!.textContent = formatMoney(bonusCost);
  }

  setWin(cents: number): void {
    this.win.textContent = cents > 0 ? formatMoney(cents) : '–';
  }

  /** Screen reader announcement for results that are only shown visually. */
  announce(text: string): void {
    this.announcer.textContent = text;
  }

  setSession(minutes: number, netCents: number): void {
    const sign = netCents > 0 ? '+' : '';
    this.session.textContent = `Session ${minutes} min · Net ${sign}${formatMoney(netCents)}`;
  }

  showMessage(text: string, kind: 'info' | 'bonus' | 'error' = 'info', holdMs = 0): void {
    clearTimeout(this.messageTimer);
    this.message.textContent = text;
    this.message.dataset.kind = kind;
    this.message.hidden = false;
    if (holdMs > 0) this.messageTimer = setTimeout(() => this.hideMessage(), holdMs);
  }

  hideMessage(): void {
    this.message.hidden = true;
  }

  render(view: HudView): void {
    const idle = view.state === 'idle';
    const busy = view.state === 'buying' || view.state === 'error';
    const stoppable = view.state === 'spinning' || view.state === 'stopping' || view.state === 'presenting';

    this.spin.dataset.mode = stoppable ? 'stop' : 'spin';
    this.spin.setAttribute('aria-label', stoppable ? 'Stop' : 'Spin');
    if (stoppable) this.spin.disabled = false; // stop / skip is always allowed
    else if (busy || view.inFreeSpins) this.spin.disabled = true; // free spins run on their own
    else this.spin.disabled = !view.canAffordSpin;

    const locked = !idle || view.inFreeSpins;
    this.betDown.disabled = locked;
    this.betUp.disabled = locked;
    this.buy.disabled = locked || !view.canAffordBonus;
  }
}
