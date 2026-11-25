import { describe, expect, it, vi } from 'vitest';
import {
  SPECIES_ORDER,
  STAGE_ORDER,
  STAGE_THRESHOLDS,
  TreeRecord,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
} from '../../shared/types';
import {
  AmbientLifeSystem,
  isPixelOpaque,
  PALETTES,
  ParticleSystem,
  renderStaticTreeToCanvas,
  renderTreeToBuffer,
  TreeScene,
  generateTreeSkeleton,
} from '../index';

function countOpaquePixels(buffer: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < buffer.length; i += 4) {
    if (buffer[i] > 0) count++;
  }
  return count;
}

function countConnectedComponents(buffer: Uint8ClampedArray): number {
  const visited = new Uint8Array(VIRTUAL_WIDTH * VIRTUAL_HEIGHT);
  let components = 0;
  const queue = new Int32Array(VIRTUAL_WIDTH * VIRTUAL_HEIGHT);

  for (let y = 0; y < VIRTUAL_HEIGHT; y++) {
    for (let x = 0; x < VIRTUAL_WIDTH; x++) {
      const startIdx = y * VIRTUAL_WIDTH + x;
      if (visited[startIdx] || buffer[startIdx * 4 + 3] === 0) continue;

      components++;
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;

      while (head < tail) {
        const curr = queue[head++];
        const cx = curr % VIRTUAL_WIDTH;
        const cy = (curr - cx) / VIRTUAL_WIDTH;

        if (cx > 0) {
          const n = curr - 1;
          if (!visited[n] && buffer[n * 4 + 3] > 0) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (cx < VIRTUAL_WIDTH - 1) {
          const n = curr + 1;
          if (!visited[n] && buffer[n * 4 + 3] > 0) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (cy > 0) {
          const n = curr - VIRTUAL_WIDTH;
          if (!visited[n] && buffer[n * 4 + 3] > 0) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (cy < VIRTUAL_HEIGHT - 1) {
          const n = curr + VIRTUAL_WIDTH;
          if (!visited[n] && buffer[n * 4 + 3] > 0) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
      }
    }
  }
  return components;
}

function createMockCanvas() {
  let lastImageData: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  const ctx = {
    imageSmoothingEnabled: true,
    createImageData(w: number, h: number) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(img: { data: Uint8ClampedArray; width: number; height: number }) {
      lastImageData = img;
    },
    clearRect: vi.fn(),
  };

  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '', imageRendering: '' },
    getContext: vi.fn(() => ctx),
    getBoundingClientRect: () => ({
      width: parseFloat(canvas.style.width) || 0,
      height: parseFloat(canvas.style.height) || 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    }),
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    ctx,
    getLastBuffer: () => lastImageData?.data ?? null,
  };
}

describe('renderTreeToBuffer & isPixelOpaque', () => {
  it('returns an exact 96x112 RGBA buffer deterministically', () => {
    const sk = generateTreeSkeleton('oak', 555);
    const a = renderTreeToBuffer(sk, 0.75, 0, 0);
    const b = renderTreeToBuffer(sk, 0.75, 0, 0);

    expect(a).toBeInstanceOf(Uint8ClampedArray);
    expect(a.length).toBe(VIRTUAL_WIDTH * VIRTUAL_HEIGHT * 4);
    expect(a).toEqual(b);
  });

  it('grows monotonically across all 6 stages for all 5 species without clipping edges', () => {
    const stageSampleProgress: Record<(typeof STAGE_ORDER)[number], number> = {
      seed: STAGE_THRESHOLDS.seed,
      sprout: STAGE_THRESHOLDS.sprout,
      sapling: STAGE_THRESHOLDS.sapling,
      young: STAGE_THRESHOLDS.young,
      full: STAGE_THRESHOLDS.full,
      ancient: 0.96,
    };

    for (const species of SPECIES_ORDER) {
      for (const seed of [17, 42, 101, 2026, 99999]) {
        const sk = generateTreeSkeleton(species, seed);
        const counts = STAGE_ORDER.map((stage) => {
          const buf = renderTreeToBuffer(sk, stageSampleProgress[stage], 0, 0);
          return countOpaquePixels(buf);
        });

        for (let i = 1; i < counts.length; i++) {
          expect(
            counts[i],
            `${species} seed=${seed} ${STAGE_ORDER[i - 1]}->${STAGE_ORDER[i]}`
          ).toBeGreaterThan(counts[i - 1]);
        }

        const fullStart = countOpaquePixels(renderTreeToBuffer(sk, STAGE_THRESHOLDS.full, 0, 0));
        const ancientStart = countOpaquePixels(
          renderTreeToBuffer(sk, STAGE_THRESHOLDS.ancient, 0, 0)
        );
        expect(ancientStart).toBeGreaterThanOrEqual(fullStart);

        // Verify full tree + 1px dark outline never clips outer frame edges
        const fullBuf = renderTreeToBuffer(sk, 1, 0, 0);
        for (let x = 0; x < VIRTUAL_WIDTH; x++) {
          expect(isPixelOpaque(fullBuf, x, 0)).toBe(false);
          expect(isPixelOpaque(fullBuf, x, VIRTUAL_HEIGHT - 1)).toBe(false);
        }
        for (let y = 0; y < VIRTUAL_HEIGHT; y++) {
          expect(isPixelOpaque(fullBuf, 0, y)).toBe(false);
          expect(isPixelOpaque(fullBuf, VIRTUAL_WIDTH - 1, y)).toBe(false);
        }

        // Sweep p = 0.00..1.00 in 0.01 steps to ensure 1 connected silhouette with zero floating parts
        for (let step = 0; step <= 100; step++) {
          const p = step / 100;
          const buf = renderTreeToBuffer(sk, p, 0, 0);
          expect(
            countConnectedComponents(buf),
            `${species} seed=${seed} p=${p.toFixed(2)} detached component`
          ).toBe(1);
        }
      }
    }
  });

  it('marks pot base opaque and (2, 2) sky corner transparent', () => {
    for (const species of SPECIES_ORDER) {
      const sk = generateTreeSkeleton(species, 321);
      for (const stage of STAGE_ORDER) {
        const buf = renderTreeToBuffer(sk, STAGE_THRESHOLDS[stage], 0, 0);
        expect(isPixelOpaque(buf, 48, 99), `${species} ${stage} pot base`).toBe(true);
        expect(isPixelOpaque(buf, 2, 2), `${species} ${stage} sky corner`).toBe(false);
        expect(isPixelOpaque(buf, -1, 50)).toBe(false);
        expect(isPixelOpaque(buf, 2, 2, 1)).toBe(false);
      }
    }
  });

  it('supports particles and ambient life natively on the 96x112 buffer', () => {
    const sk = generateTreeSkeleton('sakura', 99);
    const pal = PALETTES.sakura;
    const base = renderTreeToBuffer(sk, 1, 1.5, 0.4);
    const baseOpaque = countOpaquePixels(base);

    const particles = new ParticleSystem(42);
    particles.spawnKeystroke(sk, 1, 3);
    particles.spawnStageBurst(sk, 'ancient');
    particles.update(0.05, sk, 1, 1.5);

    const ambient = new AmbientLifeSystem(42);
    for (let i = 0; i < 40; i++) {
      ambient.update(0.1, sk, 1, i * 0.1, 21);
    }

    const combined = new Uint8ClampedArray(base);
    particles.render(combined, pal);
    ambient.render(combined, sk, pal, 1, 4.0);

    expect(countOpaquePixels(combined)).toBeGreaterThan(baseOpaque);
  });

  it('renders static canvas previews and handles TreeScene CSS hit testing', () => {
    const { canvas, ctx, getLastBuffer } = createMockCanvas();
    renderStaticTreeToCanvas(canvas, 'bonsai', 42, 1, 2);

    expect(canvas.width).toBe(VIRTUAL_WIDTH);
    expect(canvas.height).toBe(VIRTUAL_HEIGHT);
    expect(canvas.style.width).toBe(`${VIRTUAL_WIDTH * 2}px`);
    expect(canvas.style.height).toBe(`${VIRTUAL_HEIGHT * 2}px`);
    expect(canvas.style.imageRendering).toBe('pixelated');
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(getLastBuffer()).not.toBeNull();

    const scene = new TreeScene(canvas, { scale: 3, background: 'sky' });
    const tree: TreeRecord = {
      id: 'tree-1',
      species: 'oak',
      seed: 1234,
      keystrokes: 1500,
      targetKeystrokes: 1500,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    scene.setTree(tree);
    scene.onKeystroke(2);
    scene.triggerStageUp('ancient');

    // Even with sky background, isOpaqueAtCssPoint tests tree+pot buffer only!
    expect(scene.isOpaqueAtCssPoint(2 * 3, 2 * 3)).toBe(false);
    expect(scene.isOpaqueAtCssPoint(48 * 3, 99 * 3)).toBe(true);

    scene.setScale(4);
    expect(canvas.style.width).toBe(`${VIRTUAL_WIDTH * 4}px`);
    expect(scene.isOpaqueAtCssPoint(48 * 4, 99 * 4)).toBe(true);
    scene.destroy();
  });
});
