import { describe, expect, it } from 'vitest';
import { StateMachine, type GameState } from '../src/game/stateMachine';

describe('StateMachine', () => {
  it('walks through a full round', () => {
    const fsm = new StateMachine();
    const seen: GameState[] = [];
    fsm.subscribe((to) => seen.push(to));

    for (const event of ['SPIN', 'RESULT', 'STOPPED', 'DONE'] as const) {
      expect(fsm.send(event)).toBe(true);
    }
    expect(seen).toEqual(['spinning', 'stopping', 'presenting', 'idle']);
  });

  it('ignores a second SPIN while a round is running', () => {
    const fsm = new StateMachine();
    fsm.send('SPIN');
    expect(fsm.send('SPIN')).toBe(false);
    expect(fsm.state).toBe('spinning');
  });

  it('recovers from a failed request', () => {
    const fsm = new StateMachine();
    fsm.send('SPIN');
    fsm.send('FAIL');
    expect(fsm.state).toBe('error');
    expect(fsm.can('SPIN')).toBe(false);
    fsm.send('DISMISS');
    expect(fsm.state).toBe('idle');
  });

  it('can fail from any in-flight state, so an error never leaves a round stuck', () => {
    const paths = [['SPIN'], ['SPIN', 'RESULT'], ['SPIN', 'RESULT', 'STOPPED'], ['BUY']] as const;
    for (const path of paths) {
      const fsm = new StateMachine();
      for (const event of path) fsm.send(event);
      expect(fsm.send('FAIL')).toBe(true);
      expect(fsm.state).toBe('error');
    }
  });

  it('blocks spins while a bonus buy is in flight', () => {
    const fsm = new StateMachine();
    fsm.send('BUY');
    expect(fsm.send('SPIN')).toBe(false);
    fsm.send('BOUGHT');
    expect(fsm.state).toBe('idle');
  });

  it('stops notifying after unsubscribe', () => {
    const fsm = new StateMachine();
    let calls = 0;
    const off = fsm.subscribe(() => calls++);
    fsm.send('SPIN');
    off();
    fsm.send('RESULT');
    expect(calls).toBe(1);
  });
});
