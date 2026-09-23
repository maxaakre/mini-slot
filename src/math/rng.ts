/**
 * Seeded PRNG (mulberry32).
 *
 * Deterministic on purpose: the same seed replays the same session, which
 * makes simulations, tests and bug reports reproducible. A real game server
 * would use a certified CSPRNG instead — the rest of the code only depends
 * on the `Rng` interface, so swapping it is a one-line change.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
  };
}
