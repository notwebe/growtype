import { describe, expect, it } from 'vitest';
import { SPECIES_ORDER, VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../../shared/types';
import { PALETTES } from '../palettes';
import { generateTreeSkeleton } from '../treeSkeleton';

describe('generateTreeSkeleton', () => {
  it('is deterministic for every species and seed', () => {
    for (const species of SPECIES_ORDER) {
      const s1 = generateTreeSkeleton(species, 777123);
      const s2 = generateTreeSkeleton(species, 777123);
      expect(s1).toEqual(s2);
    }
  });

  it('keeps all segments, clusters, accents, perches, and pots within 96x112 virtual bounds', () => {
    const seeds = [1, 42, 1337, 99999];
    for (const species of SPECIES_ORDER) {
      for (const seed of seeds) {
        const sk = generateTreeSkeleton(species, seed);

        expect(sk.potBounds.xMin).toBeGreaterThanOrEqual(1);
        expect(sk.potBounds.xMax).toBeLessThan(VIRTUAL_WIDTH - 1);
        expect(sk.potBounds.yMin).toBeGreaterThanOrEqual(1);
        expect(sk.potBounds.yMax).toBeLessThan(VIRTUAL_HEIGHT - 1);

        expect(sk.canopyBounds.xMin).toBeGreaterThanOrEqual(2);
        expect(sk.canopyBounds.xMax).toBeLessThan(VIRTUAL_WIDTH - 2);
        expect(sk.canopyBounds.yMin).toBeGreaterThanOrEqual(8);
        expect(sk.canopyBounds.yMax).toBeLessThan(VIRTUAL_HEIGHT - 8);

        for (const seg of [...sk.trunkSegments, ...sk.branches]) {
          expect(seg.x0).toBeGreaterThanOrEqual(4);
          expect(seg.x0).toBeLessThanOrEqual(VIRTUAL_WIDTH - 5);
          expect(seg.x1).toBeGreaterThanOrEqual(4);
          expect(seg.x1).toBeLessThanOrEqual(VIRTUAL_WIDTH - 5);
          expect(seg.y0).toBeGreaterThanOrEqual(8);
          expect(seg.y0).toBeLessThanOrEqual(VIRTUAL_HEIGHT - 8);
          expect(seg.y1).toBeGreaterThanOrEqual(8);
          expect(seg.y1).toBeLessThanOrEqual(VIRTUAL_HEIGHT - 8);
          expect(seg.revealAt).toBeGreaterThanOrEqual(0);
          expect(seg.revealAt).toBeLessThanOrEqual(1);
        }

        for (const c of sk.foliageClusters) {
          expect(c.x - c.rx).toBeGreaterThanOrEqual(2);
          expect(c.x + c.rx).toBeLessThanOrEqual(VIRTUAL_WIDTH - 3);
          expect(c.y - c.ry).toBeGreaterThanOrEqual(10);
          expect(c.y + c.ry).toBeLessThanOrEqual(VIRTUAL_HEIGHT - 10);
          expect(c.revealAt).toBeGreaterThanOrEqual(0);
          expect(c.revealAt).toBeLessThanOrEqual(1);
        }

        for (const acc of sk.accents) {
          expect(acc.x).toBeGreaterThanOrEqual(4);
          expect(acc.x).toBeLessThanOrEqual(VIRTUAL_WIDTH - 5);
          expect(acc.y).toBeGreaterThanOrEqual(8);
          expect(acc.y).toBeLessThanOrEqual(VIRTUAL_HEIGHT - 10);
          expect(acc.revealAt).toBeGreaterThanOrEqual(0);
          expect(acc.revealAt).toBeLessThanOrEqual(1);
        }

        for (const perch of sk.perches) {
          expect(perch.x).toBeGreaterThanOrEqual(8);
          expect(perch.x).toBeLessThanOrEqual(VIRTUAL_WIDTH - 9);
          // Guarantees headroom for 5x4 perched songbird
          expect(perch.y).toBeGreaterThanOrEqual(12);
          expect(perch.y).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  it('produces distinct species silhouettes and matching palette configurations', () => {
    const oak = generateTreeSkeleton('oak', 101);
    const sakura = generateTreeSkeleton('sakura', 101);
    const pine = generateTreeSkeleton('pine', 101);
    const maple = generateTreeSkeleton('maple', 101);
    const bonsai = generateTreeSkeleton('bonsai', 101);

    expect(oak.potStyle).toBe('terracotta');
    expect(oak.accents.some((a) => a.kind === 'acorn')).toBe(true);

    expect(sakura.potStyle).toBe('terracotta');
    expect(sakura.accents.some((a) => a.kind === 'blossom')).toBe(true);

    expect(pine.potStyle).toBe('stoneMound');
    expect(pine.foliageClusters.every((c) => c.shape === 'pineBough')).toBe(true);
    expect(pine.accents.some((a) => a.kind === 'snow')).toBe(true);
    expect(pine.accents.some((a) => a.kind === 'pinecone')).toBe(true);

    expect(maple.potStyle).toBe('slatePot');
    expect(maple.accents.some((a) => a.kind === 'mapleLeaf')).toBe(true);

    expect(bonsai.potStyle).toBe('ceramicTray');
    expect(bonsai.potBounds.xMin).toBeLessThanOrEqual(24);
    expect(bonsai.potBounds.xMax).toBeGreaterThanOrEqual(72);
    expect(bonsai.zenStone).toBeDefined();
    expect(bonsai.foliageClusters.every((c) => c.shape === 'cloudPad')).toBe(true);
    expect(bonsai.accents.some((a) => a.kind === 'bonsaiBloom')).toBe(true);

    for (const species of SPECIES_ORDER) {
      expect(PALETTES[species].bark).toHaveLength(4);
      expect(PALETTES[species].foliage).toHaveLength(4);
      expect(PALETTES[species].pot.shades).toHaveLength(4);
    }
  });
});
