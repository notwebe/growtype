export interface Prng {
  /** Returns a deterministic float in [0, 1). */
  next(): number;
  /** Returns a deterministic float in [min, max). */
  range(min: number, max: number): number;
  /** Returns a deterministic integer in [min, max] inclusive. */
  intRange(min: number, max: number): number;
  /** Picks a deterministic element from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Returns true with probability p in [0, 1]. */
  chance(p: number): boolean;
}

/**
 * Creates a deterministic pseudo-random number generator using Mulberry32.
 */
export function createPrng(seed: number): Prng {
  let state = (Math.floor(seed) | 0) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number): number => {
    if (min >= max) return min;
    return min + next() * (max - min);
  };

  const intRange = (min: number, max: number): number => {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    if (lo >= hi) return lo;
    const value = lo + Math.floor(next() * (hi - lo + 1));
    return value > hi ? hi : value;
  };

  const pick = <T>(arr: readonly T[]): T => {
    if (arr.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return arr[intRange(0, arr.length - 1)];
  };

  const chance = (p: number): boolean => {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return next() < p;
  };

  return { next, range, intRange, pick, chance };
}
