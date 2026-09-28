import type { Grid, SpinOutcome } from '../math/engine';
import type { GameState } from './stateMachine';

/**
 * What the game needs from the outside world. The game owns these
 * interfaces and `view/` and `ui/` implement them, so dependencies point
 * from the presentation into the game and never back.
 */

export interface WaitHandle {
  /** Resolves when the wait ends or is finished early. */
  readonly done: Promise<void>;
  finish(): void;
}

/** A pause on the same clock as every animation, so skip and turbo reach it. */
export interface Clock {
  wait(ms: number): WaitHandle;
}

export interface ReelsPort {
  startSpin(): void;
  /** Resolves when every reel is at rest on `grid`. */
  stopOn(grid: Grid, options: { turbo: boolean }): Promise<void>;
  slam(): void;
  setFreeSpins(on: boolean): void;
}

export interface PresentOptions {
  /** The bet the win is measured against, in cents. */
  bet: number;
  turbo: boolean;
  reducedMotion: boolean;
  /** Called with the counted-up win in cents as it animates. */
  onCount: (cents: number) => void;
}

export interface PresenterPort {
  /** Resolves when the presentation ends or is skipped. */
  present(outcome: SpinOutcome, options: PresentOptions): Promise<void>;
  skip(): void;
}

export interface HudState {
  state: GameState;
  inFreeSpins: boolean;
  canAffordSpin: boolean;
  canAffordBonus: boolean;
}

export type MessageKind = 'info' | 'bonus' | 'error';

export interface HudPort {
  render(state: HudState): void;
  setBalance(cents: number): void;
  setBet(cents: number, bonusCost: number): void;
  setWin(cents: number): void;
  setSession(minutes: number, netCents: number): void;
  showMessage(text: string, kind?: MessageKind, holdMs?: number): void;
  hideMessage(): void;
  /** Screen reader announcement for results that are only shown visually. */
  announce(text: string): void;
}
