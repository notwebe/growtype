import {
  getGrowthProgress,
  getGrowthStage,
  GrowthStage,
  SPECIES_META,
  SPECIES_ORDER,
  SpeciesId,
  SpeciesMeta,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_THRESHOLDS,
  TreeRecord,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
} from '../shared/types';
import { AmbientLifeSystem } from './ambientLife';
import { PALETTES, Rgba, SpeciesPalette } from './palettes';
import { ParticleSystem } from './particles';
import { createPrng, Prng } from './prng';
import { isPixelOpaque, renderTreeToBuffer } from './treeRenderer';
import { generateTreeSkeleton, TreeSkeleton } from './treeSkeleton';

export {
  VIRTUAL_WIDTH,
  VIRTUAL_HEIGHT,
  getGrowthProgress,
  getGrowthStage,
  SPECIES_META,
  SPECIES_ORDER,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_THRESHOLDS,
};
export type { SpeciesId, GrowthStage, TreeRecord, SpeciesMeta };

export {
  createPrng,
  PALETTES,
  generateTreeSkeleton,
  renderTreeToBuffer,
  isPixelOpaque,
  ParticleSystem,
  AmbientLifeSystem,
};
export type { Prng, Rgba, SpeciesPalette, TreeSkeleton };

export interface TreeSceneOptions {
  scale?: number;
  ambientLife?: boolean;
  background?: 'transparent' | 'sky';
}

const BAYER_SKY: readonly [readonly [number, number], readonly [number, number]] = [
  [0, 2],
  [3, 1],
];

function writeBufferToCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  buffer: Uint8ClampedArray
): void {
  const imageData = ctx.createImageData(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  imageData.data.set(buffer);
  ctx.putImageData(imageData, 0, 0);
}

function configurePixelCanvas(canvas: HTMLCanvasElement, scale?: number): CanvasRenderingContext2D | null {
  if (canvas.width !== VIRTUAL_WIDTH) canvas.width = VIRTUAL_WIDTH;
  if (canvas.height !== VIRTUAL_HEIGHT) canvas.height = VIRTUAL_HEIGHT;
  if (scale !== undefined && scale > 0) {
    canvas.style.width = `${VIRTUAL_WIDTH * scale}px`;
    canvas.style.height = `${VIRTUAL_HEIGHT * scale}px`;
  }
  canvas.style.imageRendering = 'pixelated';

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
  }
  return ctx;
}

function drawSkyBackdrop(target: Uint8ClampedArray, isEvening: boolean): void {
  const dayBands: readonly Rgba[] = [
    [22, 34, 52, 255],
    [31, 49, 74, 255],
    [43, 68, 99, 255],
    [59, 91, 126, 255],
  ];
  const nightBands: readonly Rgba[] = [
    [12, 18, 30, 255],
    [18, 28, 46, 255],
    [25, 39, 62, 255],
    [35, 53, 80, 255],
  ];
  const bands = isEvening ? nightBands : dayBands;

  for (let y = 0; y < VIRTUAL_HEIGHT; y++) {
    const t = (y / VIRTUAL_HEIGHT) * (bands.length - 1);
    const bandIdx = Math.min(bands.length - 2, Math.floor(t));
    const frac = t - bandIdx;
    for (let x = 0; x < VIRTUAL_WIDTH; x++) {
      const bayer = (BAYER_SKY[y & 1][x & 1] + 0.5) / 4;
      const col = frac > bayer ? bands[bandIdx + 1] : bands[bandIdx];
      const idx = (y * VIRTUAL_WIDTH + x) * 4;
      target[idx] = col[0];
      target[idx + 1] = col[1];
      target[idx + 2] = col[2];
      target[idx + 3] = 255;
    }
  }

  // Subtle ground meadow band at bottom (y = 102..111)
  const groundTop: Rgba = isEvening ? [22, 34, 38, 255] : [30, 48, 48, 255];
  const groundDark: Rgba = isEvening ? [15, 23, 27, 255] : [21, 35, 36, 255];
  for (let y = 101; y < VIRTUAL_HEIGHT; y++) {
    for (let x = 0; x < VIRTUAL_WIDTH; x++) {
      const col = y <= 103 ? groundTop : groundDark;
      const idx = (y * VIRTUAL_WIDTH + x) * 4;
      target[idx] = col[0];
      target[idx + 1] = col[1];
      target[idx + 2] = col[2];
      target[idx + 3] = 255;
    }
  }
}

function compositeOver(dst: Uint8ClampedArray, src: Uint8ClampedArray): void {
  for (let i = 0; i < src.length; i += 4) {
    const sa = src[i + 3];
    if (sa === 0) continue;
    if (sa === 255 || dst[i + 3] === 0) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = sa;
    } else {
      const a = sa / 255;
      const da = dst[i + 3] / 255;
      const outA = a + da * (1 - a);
      dst[i] = Math.round((src[i] * a + dst[i] * da * (1 - a)) / outA);
      dst[i + 1] = Math.round((src[i + 1] * a + dst[i + 1] * da * (1 - a)) / outA);
      dst[i + 2] = Math.round((src[i + 2] * a + dst[i + 2] * da * (1 - a)) / outA);
      dst[i + 3] = Math.round(outA * 255);
    }
  }
}

/**
 * Renders a static pixel-art tree snapshot onto a target HTMLCanvasElement at timeSec = 0.
 */
export function renderStaticTreeToCanvas(
  canvas: HTMLCanvasElement,
  species: SpeciesId,
  seed: number,
  progress?: number,
  scale?: number
): void {
  const ctx = configurePixelCanvas(canvas, scale);
  if (!ctx) return;

  const skeleton = generateTreeSkeleton(species, seed);
  const buffer = renderTreeToBuffer(skeleton, progress ?? 1, 0, 0);
  writeBufferToCanvas(canvas, ctx, buffer);
}

/**
 * Animated pixel-art tree scene controller managing wind sway, keystroke particles,
 * stage-up bursts, ambient creatures, and pixel-accurate hit testing.
 */
export class TreeScene {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private scale: number;
  private enableAmbientLife: boolean;
  private background: 'transparent' | 'sky';

  private tree: TreeRecord | null = null;
  private skeleton: TreeSkeleton | null = null;
  private progress = 0;

  private particles = new ParticleSystem();
  private ambientLife = new AmbientLifeSystem();

  private rafId: number | null = null;
  private running = false;
  private destroyed = false;
  private lastTimestampMs: number | null = null;
  private elapsedSec = 0;
  private rustleAmount = 0;

  private lastTreeBuffer: Uint8ClampedArray = new Uint8ClampedArray(
    VIRTUAL_WIDTH * VIRTUAL_HEIGHT * 4
  );
  private compositeBuffer: Uint8ClampedArray = new Uint8ClampedArray(
    VIRTUAL_WIDTH * VIRTUAL_HEIGHT * 4
  );

  constructor(canvas: HTMLCanvasElement, options: TreeSceneOptions = {}) {
    this.canvas = canvas;
    this.scale = options.scale ?? 3;
    this.enableAmbientLife = options.ambientLife ?? true;
    this.background = options.background ?? 'transparent';
    this.ctx = configurePixelCanvas(this.canvas, this.scale);
  }

  setTree(tree: TreeRecord): void {
    if (this.destroyed) return;
    this.tree = tree;
    if (
      !this.skeleton ||
      this.skeleton.species !== tree.species ||
      this.skeleton.seed !== tree.seed
    ) {
      this.skeleton = generateTreeSkeleton(tree.species, tree.seed);
      this.particles.clear();
    }
    this.progress = getGrowthProgress(tree);
    this.renderFrame(0);
  }

  onKeystroke(count = 1): void {
    if (this.destroyed || !this.skeleton) return;
    const n = Math.max(1, count);
    this.rustleAmount = Math.min(1.5, this.rustleAmount + Math.min(0.65, 0.3 * n));
    this.particles.spawnKeystroke(this.skeleton, this.progress, n);
  }

  triggerStageUp(stage: GrowthStage): void {
    if (this.destroyed || !this.skeleton) return;
    this.rustleAmount = 1.4;
    this.particles.spawnStageBurst(this.skeleton, stage);
  }

  setScale(scale: number): void {
    if (this.destroyed || scale <= 0) return;
    this.scale = scale;
    this.ctx = configurePixelCanvas(this.canvas, this.scale);
    this.renderFrame(0);
  }

  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.lastTimestampMs = null;
    const tick = (nowMs: number): void => {
      if (!this.running || this.destroyed) return;
      const dtSec =
        this.lastTimestampMs === null
          ? 0.016
          : Math.max(0, Math.min(0.1, (nowMs - this.lastTimestampMs) / 1000));
      this.lastTimestampMs = nowMs;
      this.elapsedSec += dtSec;
      this.renderFrame(dtSec);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTimestampMs = null;
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.particles.clear();
    this.tree = null;
    this.skeleton = null;
  }

  /**
   * Maps CSS coordinates relative to canvas top-left into virtual pixel coordinates
   * and tests opacity strictly against the tree+pot buffer (ignoring sky & particles).
   */
  isOpaqueAtCssPoint(cssX: number, cssY: number, radiusPx?: number): boolean {
    let effScale = this.scale > 0 ? this.scale : 1;
    if (typeof this.canvas.getBoundingClientRect === 'function') {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0) {
        effScale = rect.width / VIRTUAL_WIDTH;
      }
    }
    const vx = cssX / effScale;
    const vy = cssY / effScale;
    const vRadius =
      radiusPx !== undefined && radiusPx > 0 ? Math.max(1, Math.round(radiusPx / effScale)) : 0;
    return isPixelOpaque(this.lastTreeBuffer, vx, vy, vRadius);
  }

  private renderFrame(dtSec: number): void {
    if (!this.ctx) return;

    if (dtSec > 0 && this.rustleAmount > 0) {
      this.rustleAmount = Math.max(0, this.rustleAmount - dtSec * 2.2);
    }

    const hour = new Date().getHours();
    const isEvening = hour >= 19 || hour < 5;

    if (!this.skeleton || !this.tree) {
      this.lastTreeBuffer.fill(0);
      if (this.background === 'sky') {
        drawSkyBackdrop(this.compositeBuffer, isEvening);
        writeBufferToCanvas(this.canvas, this.ctx, this.compositeBuffer);
      } else {
        this.ctx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
      }
      return;
    }

    const pal = PALETTES[this.skeleton.species];

    // 1. Render tree + pot into dedicated hit-test buffer (no sky or transient particles)
    this.lastTreeBuffer = renderTreeToBuffer(
      this.skeleton,
      this.progress,
      this.elapsedSec,
      this.rustleAmount
    );

    // 2. Prepare composite output buffer
    if (this.background === 'sky') {
      drawSkyBackdrop(this.compositeBuffer, isEvening);
      compositeOver(this.compositeBuffer, this.lastTreeBuffer);
    } else {
      this.compositeBuffer.set(this.lastTreeBuffer);
    }

    // 3. Update & render native-resolution particles and ambient life
    if (dtSec > 0) {
      this.particles.update(dtSec, this.skeleton, this.progress, this.elapsedSec);
      if (this.enableAmbientLife) {
        this.ambientLife.update(dtSec, this.skeleton, this.progress, this.elapsedSec, hour);
      }
    }

    this.particles.render(this.compositeBuffer, pal);
    if (this.enableAmbientLife) {
      this.ambientLife.render(
        this.compositeBuffer,
        this.skeleton,
        pal,
        this.progress,
        this.elapsedSec
      );
    }

    writeBufferToCanvas(this.canvas, this.ctx, this.compositeBuffer);
  }
}
