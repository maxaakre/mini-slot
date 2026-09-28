/**
 * Round flow as an explicit state machine.
 *
 *   idle ──SPIN──▶ spinning ──RESULT──▶ stopping ──STOPPED──▶ presenting ──DONE──▶ idle
 *     │
 *     └──BUY──▶ buying ──BOUGHT──▶ idle
 *
 *   spinning, stopping, presenting, buying ──FAIL──▶ error ──DISMISS──▶ idle
 *
 * Reels start spinning on SPIN, before the server answers, so the game
 * feels instant. FAIL is valid wherever a round is in flight, so no error
 * can leave the game stuck. Any event that is not valid in the current
 * state is ignored, which removes a whole class of double-click and race
 * bugs.
 */

export type GameState = 'idle' | 'spinning' | 'stopping' | 'presenting' | 'buying' | 'error';

export type GameEvent = 'SPIN' | 'RESULT' | 'STOPPED' | 'DONE' | 'BUY' | 'BOUGHT' | 'FAIL' | 'DISMISS';

const TRANSITIONS: Record<GameState, Partial<Record<GameEvent, GameState>>> = {
  idle: { SPIN: 'spinning', BUY: 'buying' },
  spinning: { RESULT: 'stopping', FAIL: 'error' },
  stopping: { STOPPED: 'presenting', FAIL: 'error' },
  presenting: { DONE: 'idle', FAIL: 'error' },
  buying: { BOUGHT: 'idle', FAIL: 'error' },
  error: { DISMISS: 'idle' },
};

export type TransitionListener = (to: GameState, from: GameState, event: GameEvent) => void;

export class StateMachine {
  private current: GameState = 'idle';
  private readonly listeners = new Set<TransitionListener>();

  get state(): GameState {
    return this.current;
  }

  can(event: GameEvent): boolean {
    return TRANSITIONS[this.current][event] !== undefined;
  }

  /** Returns false (and does nothing) if the event is not valid right now. */
  send(event: GameEvent): boolean {
    const next = TRANSITIONS[this.current][event];
    if (!next) return false;
    const previous = this.current;
    this.current = next;
    for (const listener of this.listeners) listener(next, previous, event);
    return true;
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: TransitionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
