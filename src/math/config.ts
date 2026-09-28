import { createRng } from './rng';

/**
 * Game math configuration. Everything that decides RTP lives here, so the
 * math can be tuned and verified (`npm run simulate`) without touching
 * server or client code.
 */

export const REELS = 5;
export const ROWS = 3;

export const Sym = {
  J: 0,
  Q: 1,
  K: 2,
  A: 3,
  ORB: 4,
  GEM: 5,
  STAR: 6,
  WILD: 7,
  SCATTER: 8,
} as const;

export type SymbolId = (typeof Sym)[keyof typeof Sym];

export const SYMBOL_NAMES: Record<SymbolId, string> = {
  [Sym.J]: 'J',
  [Sym.Q]: 'Q',
  [Sym.K]: 'K',
  [Sym.A]: 'A',
  [Sym.ORB]: 'Orb',
  [Sym.GEM]: 'Gem',
  [Sym.STAR]: 'Star',
  [Sym.WILD]: 'Wild',
  [Sym.SCATTER]: 'Bonus',
};

/** Shortest run that pays on a line. */
export const LINE_MIN_COUNT = 3;

/** Line pays for 3, 4 and 5 of a kind, in multiples of the line bet. */
export const PAYTABLE: Partial<Record<SymbolId, readonly [number, number, number]>> = {
  [Sym.J]: [5, 20, 60],
  [Sym.Q]: [5, 20, 60],
  [Sym.K]: [10, 25, 90],
  [Sym.A]: [10, 25, 90],
  [Sym.ORB]: [20, 50, 175],
  [Sym.GEM]: [25, 90, 300],
  [Sym.STAR]: [40, 125, 600],
  [Sym.WILD]: [50, 250, 1000],
};

/** Fewest scatters that pay. */
export const SCATTER_MIN_COUNT = 3;

/** Scatter pays anywhere, in multiples of the total bet. Index = count - SCATTER_MIN_COUNT. */
export const SCATTER_PAYS: readonly number[] = [2, 10, 50];

/** Row index per reel, left to right. */
export const PAYLINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
];

export const FREE_SPINS = {
  /** Scatters needed to trigger. */
  trigger: 3,
  awarded: 10,
  /** Extra spins when the trigger lands again during the bonus. */
  retrigger: 5,
  /** Hard cap so a bonus can never run forever. */
  maxSpins: 50,
  winMultiplier: 5,
} as const;

/**
 * "Bonus buy" price, in multiples of the total bet. Tuned with
 * `npm run simulate` so the bought bonus returns about the same RTP as the
 * base game.
 */
export const BONUS_BUY_COST = 77;

/** Wins at or above this many total bets count as a big win. */
export const BIG_WIN_BETS = 15;

/** Bet levels in cents. Multiples of the line count keep line bets integer. */
export const BET_LEVELS: readonly number[] = [10, 20, 50, 100, 200, 500];

/** How many of each symbol a strip holds, indexed by `SymbolId`. */
type SymbolCounts = readonly number[];

/** Symbol counts per reel for the base game. The strips are built from these. */
const BASE_REEL_COUNTS: readonly SymbolCounts[] = [
  // J  Q  K  A  Orb Gem Star Wild Bonus
  [8, 8, 7, 7, 5, 4, 3, 1, 1],
  [8, 8, 7, 7, 5, 4, 3, 2, 1],
  [8, 8, 7, 7, 5, 4, 3, 2, 2],
  [8, 8, 7, 7, 5, 4, 3, 2, 1],
  [8, 8, 7, 7, 5, 4, 3, 1, 1],
];

/**
 * Builds a reel strip from symbol counts and shuffles it with a fixed seed,
 * so the strips are identical on every run and in every environment.
 */
function buildStrip(counts: SymbolCounts, seed: number): SymbolId[] {
  const strip: SymbolId[] = [];
  counts.forEach((count, id) => {
    for (let i = 0; i < count; i++) strip.push(id as SymbolId);
  });
  const rng = createRng(seed);
  // Fisher–Yates shuffle.
  for (let i = strip.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [strip[i], strip[j]] = [strip[j]!, strip[i]!];
  }
  return strip;
}

/**
 * Free spins use their own, richer strips (more wilds and premiums). This is
 * how most modern slots make the bonus feel different from the base game.
 */
const FREE_REEL_COUNTS: readonly SymbolCounts[] = [
  // J  Q  K  A  Orb Gem Star Wild Bonus
  [6, 6, 6, 6, 5, 4, 4, 2, 1],
  [6, 6, 6, 6, 5, 4, 4, 4, 1],
  [6, 6, 6, 6, 5, 4, 4, 4, 1],
  [6, 6, 6, 6, 5, 4, 4, 4, 1],
  [6, 6, 6, 6, 5, 4, 4, 2, 1],
];

export type ReelSet = readonly (readonly SymbolId[])[];

export const BASE_STRIPS: ReelSet = BASE_REEL_COUNTS.map((counts, i) => buildStrip(counts, 1000 + i));
export const FREE_STRIPS: ReelSet = FREE_REEL_COUNTS.map((counts, i) => buildStrip(counts, 2000 + i));
