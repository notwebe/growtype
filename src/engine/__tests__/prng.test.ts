import { describe, expect, it } from 'vitest';
import { createPrng } from '../prng';

describe('createPrng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = createPrng(424242);
    const b = createPrng(424242);

    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
    expect(a.range(-5, 12)).toBe(b.range(-5, 12));
    expect(a.intRange(1, 100)).toBe(b.intRange(1, 100));
    expect(a.pick(['oak', 'sakura', 'pine', 'maple', 'bonsai'])).toBe(
      b.pick(['oak', 'sakura', 'pine', 'maple', 'bonsai'])
    );
    expect(a.chance(0.37)).toBe(b.chance(0.37));
  });

  it('produces distinct sequences for different seeds, including 0 and negative seeds', () => {
    const p0 = createPrng(0);
    const p1 = createPrng(1);
    const pNeg = createPrng(-12345);

    const seq0 = Array.from({ length: 5 }, () => p0.next());
    const seq1 = Array.from({ length: 5 }, () => p1.next());
    const seqNeg = Array.from({ length: 5 }, () => pNeg.next());

    expect(seq0).not.toEqual(seq1);
    expect(seq0).not.toEqual(seqNeg);
    expect(seq1).not.toEqual(seqNeg);
  });

  it('respects bounds for next, range, intRange, pick, and chance', () => {
    const rng = createPrng(98765);
    const seenInts = new Set<number>();
    const options = ['a', 'b', 'c', 'd'] as const;

    for (let i = 0; i < 200; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);

      const r = rng.range(-3.5, 7.25);
      expect(r).toBeGreaterThanOrEqual(-3.5);
      expect(r).toBeLessThan(7.25);

      const k = rng.intRange(2, 6);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(6);
      seenInts.add(k);

      expect(options).toContain(rng.pick(options));
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }

    expect(seenInts.size).toBe(5);
    expect(rng.intRange(5, 5)).toBe(5);
    expect(() => rng.pick([])).toThrow();
  });
});
