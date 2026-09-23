import {
  FREE_SPINS,
  PAYLINES,
  PAYTABLE,
  REELS,
  ROWS,
  SCATTER_PAYS,
  BASE_STRIPS,
  FREE_STRIPS,
  Sym,
  type ReelSet,
  type SymbolId,
} from './config';
import type { Rng } from './rng';

/** grid[reel][row] */
export type Grid = SymbolId[][];

export type Position = readonly [reel: number, row: number];

export interface LineWin {
  line: number;
  symbol: SymbolId;
  count: number;
  positions: Position[];
  /** Cents. */
  amount: number;
}

export interface SpinOutcome {
  stops: number[];
  grid: Grid;
  lineWins: LineWin[];
  scatterPositions: Position[];
  /** Cents. */
  scatterWin: number;
  /** Cents, including the multiplier. */
  totalWin: number;
  multiplier: number;
  freeSpinsAwarded: number;
}

export type SpinMode = 'base' | 'free';

export function stripsFor(mode: SpinMode): ReelSet {
  return mode === 'free' ? FREE_STRIPS : BASE_STRIPS;
}

export function drawStops(rng: Rng, strips: ReelSet): number[] {
  return strips.map((strip) => rng.int(strip.length));
}

export function gridFromStops(stops: readonly number[], strips: ReelSet): Grid {
  return strips.map((strip, reel) => {
    const stop = stops[reel] ?? 0;
    const column: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) {
      column.push(strip[(stop + row) % strip.length]!);
    }
    return column;
  });
}

function symbolAt(grid: Grid, reel: number, row: number): SymbolId {
  const symbol = grid[reel]?.[row];
  if (symbol === undefined) throw new Error(`No symbol at ${reel},${row}`);
  return symbol;
}

/** Longest left-to-right run of `symbol`, where wilds substitute. */
function runLength(symbols: readonly SymbolId[], symbol: SymbolId): number {
  let count = 0;
  for (const s of symbols) {
    if (s === symbol || s === Sym.WILD) count++;
    else break;
  }
  return count;
}

function linePay(symbol: SymbolId, count: number): number {
  if (count < 3) return 0;
  return PAYTABLE[symbol]?.[count - 3] ?? 0;
}

/**
 * Evaluates one payline. Pays the best of:
 *  - the first non-wild symbol, with wilds substituting
 *  - a pure run of wilds (wilds have their own, higher pay)
 */
export function evaluateLine(symbols: readonly SymbolId[]): { symbol: SymbolId; count: number; pay: number } | null {
  let wildCount = 0;
  while (symbols[wildCount] === Sym.WILD) wildCount++;

  const wildPay = linePay(Sym.WILD, wildCount);

  const target = symbols.find((s) => s !== Sym.WILD);
  let targetCount = 0;
  let targetPay = 0;
  if (target !== undefined && target !== Sym.SCATTER) {
    targetCount = runLength(symbols, target);
    targetPay = linePay(target, targetCount);
  }

  if (wildPay === 0 && targetPay === 0) return null;
  return wildPay >= targetPay
    ? { symbol: Sym.WILD, count: wildCount, pay: wildPay }
    : { symbol: target!, count: targetCount, pay: targetPay };
}

/**
 * Pure evaluation of a grid. `bet` is the total bet in cents and must be a
 * multiple of the payline count, so every win is a whole number of cents.
 */
export function evaluate(grid: Grid, bet: number, multiplier = 1): Omit<SpinOutcome, 'stops'> {
  if (bet % PAYLINES.length !== 0) {
    throw new Error(`Bet ${bet} must be a multiple of ${PAYLINES.length}`);
  }
  const lineBet = bet / PAYLINES.length;

  const lineWins: LineWin[] = [];
  PAYLINES.forEach((rows, line) => {
    const symbols = rows.map((row, reel) => symbolAt(grid, reel, row));
    const result = evaluateLine(symbols);
    if (!result) return;
    lineWins.push({
      line,
      symbol: result.symbol,
      count: result.count,
      positions: rows.slice(0, result.count).map((row, reel) => [reel, row] as const),
      amount: result.pay * lineBet * multiplier,
    });
  });

  const scatterPositions: Position[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (symbolAt(grid, reel, row) === Sym.SCATTER) scatterPositions.push([reel, row]);
    }
  }
  const scatterCount = Math.min(scatterPositions.length, 2 + SCATTER_PAYS.length);
  const scatterWin = scatterCount >= 3 ? (SCATTER_PAYS[scatterCount - 3] ?? 0) * bet * multiplier : 0;

  const totalWin = lineWins.reduce((sum, w) => sum + w.amount, 0) + scatterWin;

  return {
    grid,
    lineWins,
    scatterPositions,
    scatterWin,
    totalWin,
    multiplier,
    freeSpinsAwarded: 0,
  };
}

/** Plays one spin. Free spins apply the bonus multiplier and award retriggers. */
export function playSpin(rng: Rng, bet: number, mode: SpinMode): SpinOutcome {
  const strips = stripsFor(mode);
  const stops = drawStops(rng, strips);
  const multiplier = mode === 'free' ? FREE_SPINS.winMultiplier : 1;
  const result = evaluate(gridFromStops(stops, strips), bet, multiplier);
  const triggered = result.scatterPositions.length >= FREE_SPINS.trigger;
  const freeSpinsAwarded = triggered ? (mode === 'base' ? FREE_SPINS.awarded : FREE_SPINS.retrigger) : 0;
  return { ...result, stops, freeSpinsAwarded };
}

/** Plays a whole bonus. Used by the simulator; the server plays it spin by spin. */
export function playBonus(rng: Rng, bet: number, initialSpins: number = FREE_SPINS.awarded): { spins: number; totalWin: number } {
  let remaining = initialSpins;
  let played = 0;
  let totalWin = 0;
  while (remaining > 0) {
    const outcome = playSpin(rng, bet, 'free');
    remaining--;
    played++;
    totalWin += outcome.totalWin;
    remaining = Math.min(remaining + outcome.freeSpinsAwarded, FREE_SPINS.maxSpins - played);
  }
  return { spins: played, totalWin };
}
