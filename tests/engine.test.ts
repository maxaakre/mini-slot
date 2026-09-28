import { describe, expect, it } from 'vitest';
import { BASE_STRIPS, FREE_SPINS, PAYLINES, PAYTABLE, REELS, ROWS, SCATTER_PAYS, Sym, type SymbolId } from '../src/math/config';
import {
  evaluate,
  evaluateLine,
  gridFromStops,
  playBonus,
  playSpin,
  retriggerSpins,
  type Grid,
} from '../src/math/engine';
import { createRng } from '../src/math/rng';

const { J, Q, K, A, ORB, GEM, STAR, WILD, SCATTER } = Sym;

/** Builds a grid where every cell is `fill`, then applies overrides. */
function grid(fill: SymbolId, cells: [reel: number, row: number, symbol: SymbolId][] = []): Grid {
  const g: Grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, () => fill));
  for (const [reel, row, symbol] of cells) g[reel]![row] = symbol;
  return g;
}

/** A grid with no line wins: reels 1 and 2 share no symbols. */
const NO_WIN: Grid = [
  [J, Q, K],
  [A, ORB, GEM],
  [J, Q, K],
  [A, ORB, GEM],
  [J, Q, K],
];

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('stays within range', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10_000; i++) {
      const n = rng.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });
});

describe('evaluateLine', () => {
  it('pays three of a kind from the left', () => {
    expect(evaluateLine([K, K, K, J, Q])).toEqual({ symbol: K, count: 3, pay: PAYTABLE[K]![0] });
  });

  it('does not pay a run that does not start on reel 1', () => {
    expect(evaluateLine([J, K, K, K, K])).toBeNull();
  });

  it('lets wilds substitute', () => {
    expect(evaluateLine([WILD, K, WILD, K, J])).toEqual({ symbol: K, count: 4, pay: PAYTABLE[K]![1] });
  });

  it('pays the wild run when it beats the substituted symbol', () => {
    // 3 wilds (50) beats 4 J (20).
    expect(evaluateLine([WILD, WILD, WILD, J, Q])).toEqual({ symbol: WILD, count: 3, pay: PAYTABLE[WILD]![0] });
  });

  it('never pays scatters on a line', () => {
    expect(evaluateLine([SCATTER, SCATTER, SCATTER, SCATTER, SCATTER])).toBeNull();
  });
});

describe('evaluate', () => {
  it('returns no win for a dead grid', () => {
    const result = evaluate(NO_WIN, 100);
    expect(result.lineWins).toEqual([]);
    expect(result.totalWin).toBe(0);
  });

  it('pays every line on a full grid', () => {
    const result = evaluate(grid(STAR), 100);
    expect(result.lineWins).toHaveLength(PAYLINES.length);
    const lineBet = 100 / PAYLINES.length;
    expect(result.totalWin).toBe(PAYLINES.length * PAYTABLE[STAR]![2] * lineBet);
  });

  it('pays scatters anywhere, based on total bet', () => {
    const g = NO_WIN.map((col) => [...col]);
    g[0]![0] = SCATTER;
    g[2]![2] = SCATTER;
    g[4]![1] = SCATTER;
    const result = evaluate(g, 100);
    expect(result.scatterPositions).toHaveLength(3);
    expect(result.scatterWin).toBe(SCATTER_PAYS[0]! * 100);
  });

  it('applies the multiplier to every win', () => {
    const single = evaluate(grid(STAR), 100, 1).totalWin;
    expect(evaluate(grid(STAR), 100, 5).totalWin).toBe(single * 5);
  });

  it('keeps all wins in whole cents', () => {
    const rng = createRng(3);
    for (let i = 0; i < 5_000; i++) {
      expect(Number.isInteger(playSpin(rng, 10, 'base').totalWin)).toBe(true);
    }
  });

  it('rejects bets that are not a multiple of the line count', () => {
    expect(() => evaluate(NO_WIN, 15)).toThrow();
  });
});

describe('spins', () => {
  it('builds the grid from reel stops', () => {
    const g = gridFromStops([0, 0, 0, 0, 0], BASE_STRIPS);
    g.forEach((column, reel) => expect(column).toEqual(BASE_STRIPS[reel]!.slice(0, ROWS)));
  });

  it('wraps around the end of a strip', () => {
    const last = BASE_STRIPS[0]!.length - 1;
    const column = gridFromStops([last, 0, 0, 0, 0], BASE_STRIPS)[0]!;
    expect(column).toEqual([BASE_STRIPS[0]![last], BASE_STRIPS[0]![0], BASE_STRIPS[0]![1]]);
  });

  it('caps retriggers at the spin limit', () => {
    expect(retriggerSpins(10, 5)).toBe(5);
    expect(retriggerSpins(FREE_SPINS.maxSpins - 2, 5)).toBe(2);
    expect(retriggerSpins(FREE_SPINS.maxSpins, 5)).toBe(0);
  });

  it('never runs a bonus past the spin cap', () => {
    const rng = createRng(9);
    for (let i = 0; i < 2_000; i++) {
      expect(playBonus(rng, 100).spins).toBeLessThanOrEqual(FREE_SPINS.maxSpins);
    }
  });
});

describe('RTP', () => {
  // Fixed seed makes this a regression test, not a flaky statistical one:
  // any math change that moves RTP shows up here.
  it('stays in the target band', () => {
    const rng = createRng(1);
    const spins = 300_000;
    let won = 0;
    for (let i = 0; i < spins; i++) {
      const outcome = playSpin(rng, 100, 'base');
      won += outcome.totalWin;
      if (outcome.freeSpinsAwarded > 0) won += playBonus(rng, 100, outcome.freeSpinsAwarded).totalWin;
    }
    const rtp = won / (spins * 100);
    expect(rtp).toBeGreaterThan(0.92);
    expect(rtp).toBeLessThan(1.0);
  });
});
