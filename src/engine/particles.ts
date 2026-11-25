import { GrowthStage, VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../shared/types';
import { Rgba, SpeciesPalette } from './palettes';
import { createPrng, Prng } from './prng';
import { TreeSkeleton } from './treeSkeleton';

export type ParticleKind = 'sparkle' | 'leaf' | 'burst';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  colorIdx: number;
  phase: number;
  size: 1 | 2;
}

const MAX_PARTICLES = 72;

function blendPixel(buf: Uint8ClampedArray, x: number, y: number, color: Rgba, alphaScale: number): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= VIRTUAL_WIDTH || iy < 0 || iy >= VIRTUAL_HEIGHT) return;
  const a = (color[3] / 255) * Math.max(0, Math.min(1, alphaScale));
  if (a <= 0.02) return;

  const idx = (iy * VIRTUAL_WIDTH + ix) * 4;
  const dstA = buf[idx + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;

  buf[idx] = Math.round((color[0] * a + buf[idx] * dstA * (1 - a)) / outA);
  buf[idx + 1] = Math.round((color[1] * a + buf[idx + 1] * dstA * (1 - a)) / outA);
  buf[idx + 2] = Math.round((color[2] * a + buf[idx + 2] * dstA * (1 - a)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

/**
 * Pixel-scale particle system rendered directly onto the 96 x 112 RGBA buffer.
 */
export class ParticleSystem {
  private particles: Particle[] = [];
  private rng: Prng;
  private ambientTimer = 0;

  constructor(seed = 1337) {
    this.rng = createPrng(seed);
  }

  get count(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles = [];
    this.ambientTimer = 0;
  }

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles.shift();
    }
    this.particles.push(p);
  }

  /**
   * Emits 1-3 rising sparkles from soil and occasionally a fluttering leaf/petal from canopy.
   */
  spawnKeystroke(skeleton: TreeSkeleton, progress: number, count = 1): void {
    const numSparkles = Math.min(3, Math.max(1, count > 2 ? 3 : this.rng.intRange(1, 2)));
    for (let i = 0; i < numSparkles; i++) {
      this.push({
        kind: 'sparkle',
        x: skeleton.baseX + this.rng.range(-7, 7),
        y: skeleton.soilY + this.rng.range(-1.5, 1),
        vx: this.rng.range(-4, 4),
        vy: this.rng.range(-18, -10),
        age: 0,
        life: this.rng.range(0.55, 0.95),
        colorIdx: this.rng.intRange(0, 2),
        phase: this.rng.range(0, Math.PI * 2),
        size: this.rng.chance(0.3) ? 2 : 1,
      });
    }

    // Occasionally emit a fluttering leaf/petal from canopy once sapling+
    const leafChance = Math.min(0.65, 0.24 + (Math.max(1, count) - 1) * 0.14);
    if (progress >= 0.12 && this.rng.chance(leafChance)) {
      this.spawnLeafFromCanopy(skeleton, progress);
    }
  }

  /**
   * Emits 20 celebratory burst pixels on stage-up.
   */
  spawnStageBurst(skeleton: TreeSkeleton, stage: GrowthStage): void {
    const centerY =
      stage === 'seed' || stage === 'sprout'
        ? skeleton.soilY - 6
        : (skeleton.canopyBounds.yMin + skeleton.canopyBounds.yMax) * 0.52;

    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2 + this.rng.range(-0.18, 0.18);
      const speed = this.rng.range(12, 30);
      this.push({
        kind: 'burst',
        x: skeleton.baseX + this.rng.range(-3, 3),
        y: centerY + this.rng.range(-3, 3),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        age: 0,
        life: this.rng.range(0.75, 1.25),
        colorIdx: i % 3,
        phase: this.rng.range(0, Math.PI * 2),
        size: i % 4 === 0 ? 2 : 1,
      });
    }
  }

  private spawnLeafFromCanopy(skeleton: TreeSkeleton, progress: number): void {
    const b = skeleton.canopyBounds;
    const ySpan = Math.max(4, (b.yMax - b.yMin) * Math.min(1, progress));
    const yStart = Math.max(b.yMin, b.yMax - ySpan);
    this.push({
      kind: 'leaf',
      x: this.rng.range(b.xMin + 2, b.xMax - 2),
      y: this.rng.range(yStart, b.yMax),
      vx: this.rng.range(-5, 5),
      vy: this.rng.range(5, 10),
      age: 0,
      life: this.rng.range(2.0, 3.4),
      colorIdx: this.rng.intRange(0, 2),
      phase: this.rng.range(0, Math.PI * 2),
      size: this.rng.chance(0.35) ? 2 : 1,
    });
  }

  update(dtSec: number, skeleton: TreeSkeleton, progress: number, _timeSec: number): void {
    const dt = Math.max(0, Math.min(0.1, dtSec));

    // Ambient drifting leaves/petals at Full Canopy and Ancient stages
    if (progress >= 0.62) {
      this.ambientTimer += dt;
      const interval =
        skeleton.species === 'sakura' || skeleton.species === 'maple' ? 1.15 : 2.2;
      if (this.ambientTimer >= interval) {
        this.ambientTimer = 0;
        if (this.particles.filter((p) => p.kind === 'leaf').length < 5) {
          this.spawnLeafFromCanopy(skeleton, progress);
        }
      }
    }

    const nextList: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;

      if (p.kind === 'sparkle') {
        p.x += (p.vx + Math.sin(p.age * 7 + p.phase) * 3.5) * dt;
        p.y += p.vy * dt;
        p.vy *= 0.98;
      } else if (p.kind === 'leaf') {
        p.x += (p.vx + Math.sin(p.age * 3.6 + p.phase) * 8.5) * dt;
        p.y += p.vy * dt;
      } else {
        // burst
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.95;
        p.vy = p.vy * 0.95 + 18 * dt;
      }

      if (p.y < -2 || p.y > VIRTUAL_HEIGHT + 2 || p.x < -2 || p.x > VIRTUAL_WIDTH + 2) {
        continue;
      }
      nextList.push(p);
    }
    this.particles = nextList;
  }

  render(buffer: Uint8ClampedArray, palette: SpeciesPalette): void {
    for (const p of this.particles) {
      const lifeRatio = p.age / p.life;
      const alpha = lifeRatio < 0.15 ? lifeRatio / 0.15 : Math.max(0, 1 - (lifeRatio - 0.15) / 0.85);

      if (p.kind === 'leaf') {
        const col = palette.particles.leaf[p.colorIdx % palette.particles.leaf.length];
        blendPixel(buffer, p.x, p.y, col, alpha);
        if (p.size === 2) {
          blendPixel(buffer, p.x + 1, p.y, col, alpha * 0.85);
        }
      } else if (p.kind === 'burst') {
        const pool =
          p.colorIdx === 0
            ? palette.particles.shimmer
            : palette.particles.keystroke;
        const col = pool[p.colorIdx % pool.length];
        blendPixel(buffer, p.x, p.y, col, alpha);
        if (p.size === 2 && lifeRatio < 0.6) {
          blendPixel(buffer, p.x, p.y - 1, col, alpha * 0.55);
        }
      } else {
        const col = palette.particles.keystroke[p.colorIdx % palette.particles.keystroke.length];
        const twinkle = 0.65 + 0.35 * Math.sin(p.age * 16 + p.phase);
        blendPixel(buffer, p.x, p.y, col, alpha * twinkle);
        if (p.size === 2 && twinkle > 0.75) {
          blendPixel(buffer, p.x, p.y - 1, col, alpha * 0.45);
        }
      }
    }
  }
}
