import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../shared/types';
import { Rgba, SpeciesPalette } from './palettes';
import { createPrng, Prng } from './prng';
import { computeSwayOffset } from './treeRenderer';
import { PerchPoint, TreeSkeleton } from './treeSkeleton';

interface Butterfly {
  orbitRadiusX: number;
  orbitRadiusY: number;
  speed: number;
  phase: number;
  flapSpeed: number;
}

type BirdState = 'away' | 'flyingIn' | 'perched' | 'flyingOut';

interface Songbird {
  state: BirdState;
  timer: number;
  duration: number;
  perchIndex: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  x: number;
  y: number;
  facing: -1 | 1;
  noteTimer: number;
  noteLife: number;
  noteX: number;
  noteY: number;
}

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  speed: number;
}

const EYE_RGBA: Rgba = [20, 18, 24, 255];
const NOTE_RGBA: Rgba = [255, 243, 176, 255];
const FIREFLY_CORE: Rgba = [255, 240, 140, 255];
const FIREFLY_HALO: Rgba = [255, 224, 102, 95];

function setSolidPixel(buf: Uint8ClampedArray, x: number, y: number, color: Rgba): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= VIRTUAL_WIDTH || iy < 0 || iy >= VIRTUAL_HEIGHT) return;
  const idx = (iy * VIRTUAL_WIDTH + ix) * 4;
  buf[idx] = color[0];
  buf[idx + 1] = color[1];
  buf[idx + 2] = color[2];
  buf[idx + 3] = color[3];
}

function blendPixel(buf: Uint8ClampedArray, x: number, y: number, color: Rgba, alphaScale = 1): void {
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
 * Ambient pixel creatures rendered natively onto the 96 x 112 buffer:
 * - Animated 3x2 flapping butterflies (progress >= 0.62)
 * - Species-matched 5x4 songbird that flies in, perches, sings, and departs (progress >= 0.90)
 * - Blinking evening fireflies (progress >= 0.32 when local hour >= 19 or < 5)
 */
export class AmbientLifeSystem {
  private rng: Prng;
  private butterflies: Butterfly[];
  private bird: Songbird;
  private fireflies: Firefly[];
  private showFireflies = false;

  constructor(seed = 4099) {
    this.rng = createPrng(seed);
    this.butterflies = [
      { orbitRadiusX: 14, orbitRadiusY: 7, speed: 0.75, phase: 0.4, flapSpeed: 10 },
      { orbitRadiusX: 18, orbitRadiusY: 9, speed: -0.62, phase: 2.8, flapSpeed: 11.5 },
    ];
    this.bird = {
      state: 'away',
      timer: 0,
      duration: 2.4,
      perchIndex: 0,
      startX: -6,
      startY: 16,
      endX: 48,
      endY: 20,
      x: -6,
      y: 16,
      facing: 1,
      noteTimer: 0,
      noteLife: 0,
      noteX: 0,
      noteY: 0,
    };
    this.fireflies = Array.from({ length: 4 }, (_, i) => ({
      x: 24 + i * 16,
      y: 42 + (i % 2) * 18,
      vx: this.rng.range(-4, 4),
      vy: this.rng.range(-2.5, 2.5),
      phase: i * 1.7,
      speed: this.rng.range(1.8, 2.8),
    }));
  }

  private getPerchWorld(perch: PerchPoint, timeSec: number): { x: number; y: number } {
    const swayDx = computeSwayOffset(perch.y, 2, timeSec, 0, perch.x);
    return { x: perch.x + swayDx, y: perch.y };
  }

  update(
    dtSec: number,
    skeleton: TreeSkeleton,
    progress: number,
    timeSec: number,
    localHour = new Date().getHours()
  ): void {
    const dt = Math.max(0, Math.min(0.1, dtSec));
    this.showFireflies = progress >= 0.32 && (localHour >= 19 || localHour < 5);

    // Update evening fireflies
    if (this.showFireflies) {
      const b = skeleton.canopyBounds;
      for (const f of this.fireflies) {
        f.x += (f.vx + Math.sin(timeSec * 0.9 + f.phase) * 2.2) * dt;
        f.y += (f.vy + Math.cos(timeSec * 1.1 + f.phase) * 1.5) * dt;
        if (f.x < Math.max(6, b.xMin - 6) || f.x > Math.min(VIRTUAL_WIDTH - 7, b.xMax + 6)) {
          f.vx = -f.vx;
          f.x = Math.max(6, Math.min(VIRTUAL_WIDTH - 7, f.x));
        }
        if (f.y < Math.max(12, b.yMin - 4) || f.y > skeleton.soilY - 2) {
          f.vy = -f.vy;
          f.y = Math.max(12, Math.min(skeleton.soilY - 2, f.y));
        }
      }
    }

    // Update songbird state machine (progress >= 0.90)
    if (progress < 0.90 || skeleton.perches.length === 0) {
      this.bird.state = 'away';
      this.bird.timer = 0;
      this.bird.noteLife = 0;
      return;
    }

    this.bird.timer += dt;
    if (this.bird.noteLife > 0) {
      this.bird.noteLife = Math.max(0, this.bird.noteLife - dt);
      this.bird.noteY -= 4.5 * dt;
    }

    const perch = skeleton.perches[this.bird.perchIndex % skeleton.perches.length];
    const target = this.getPerchWorld(perch, timeSec);

    if (this.bird.state === 'away') {
      if (this.bird.timer >= this.bird.duration) {
        this.bird.perchIndex = this.rng.intRange(0, skeleton.perches.length - 1);
        const chosen = skeleton.perches[this.bird.perchIndex];
        const chosenWorld = this.getPerchWorld(chosen, timeSec);
        const fromLeft = chosenWorld.x >= 48 ? false : true;
        this.bird.startX = fromLeft ? -5 : VIRTUAL_WIDTH + 4;
        this.bird.startY = Math.max(8, chosenWorld.y - 10);
        this.bird.endX = chosenWorld.x;
        this.bird.endY = chosenWorld.y;
        this.bird.facing = fromLeft ? 1 : -1;
        this.bird.state = 'flyingIn';
        this.bird.timer = 0;
        this.bird.duration = 1.6;
      }
    } else if (this.bird.state === 'flyingIn') {
      const t = Math.min(1, this.bird.timer / this.bird.duration);
      const ease = 1 - Math.pow(1 - t, 2);
      this.bird.x = this.bird.startX + (target.x - this.bird.startX) * ease;
      this.bird.y =
        this.bird.startY + (target.y - this.bird.startY) * ease - Math.sin(t * Math.PI) * 5;
      if (t >= 1) {
        this.bird.state = 'perched';
        this.bird.timer = 0;
        this.bird.duration = this.rng.range(7.5, 11.5);
        this.bird.facing = perch.facing;
        this.bird.noteTimer = 0.9;
      }
    } else if (this.bird.state === 'perched') {
      this.bird.x = target.x;
      this.bird.y = target.y;
      this.bird.facing = perch.facing;
      this.bird.noteTimer -= dt;
      if (this.bird.noteTimer <= 0) {
        this.bird.noteTimer = this.rng.range(2.2, 3.6);
        this.bird.noteLife = 1.3;
        this.bird.noteX = target.x + perch.facing * 3;
        this.bird.noteY = target.y - 6;
      }
      if (this.bird.timer >= this.bird.duration) {
        const exitLeft = perch.facing === -1;
        this.bird.startX = target.x;
        this.bird.startY = target.y;
        this.bird.endX = exitLeft ? -6 : VIRTUAL_WIDTH + 5;
        this.bird.endY = Math.max(6, target.y - 12);
        this.bird.facing = exitLeft ? -1 : 1;
        this.bird.state = 'flyingOut';
        this.bird.timer = 0;
        this.bird.duration = 1.5;
      }
    } else if (this.bird.state === 'flyingOut') {
      const t = Math.min(1, this.bird.timer / this.bird.duration);
      const ease = t * t;
      this.bird.x = this.bird.startX + (this.bird.endX - this.bird.startX) * ease;
      this.bird.y =
        this.bird.startY + (this.bird.endY - this.bird.startY) * ease - Math.sin(t * Math.PI) * 4;
      if (t >= 1) {
        this.bird.state = 'away';
        this.bird.timer = 0;
        this.bird.duration = this.rng.range(9.0, 14.0);
      }
    }
  }

  private renderButterflies(
    buffer: Uint8ClampedArray,
    skeleton: TreeSkeleton,
    palette: SpeciesPalette,
    progress: number,
    timeSec: number
  ): void {
    if (progress < 0.62) return;
    const count = progress >= 0.90 ? 2 : 1;
    const b = skeleton.canopyBounds;
    const cx = (b.xMin + b.xMax) * 0.5;
    const cy = (b.yMin + b.yMax) * 0.45;
    const wingA = palette.butterfly[0];
    const wingB = palette.butterfly[1];
    const body = palette.outline;

    for (let i = 0; i < count; i++) {
      const bf = this.butterflies[i];
      const ang = timeSec * bf.speed + bf.phase;
      const bx = Math.round(cx + Math.sin(ang) * bf.orbitRadiusX);
      const by = Math.round(cy + Math.sin(ang * 2) * bf.orbitRadiusY);
      const wingsUp = Math.floor(timeSec * bf.flapSpeed + i) % 2 === 0;

      if (wingsUp) {
        // Frame 0 (3x2): [W, ., W] / [., B, .]
        setSolidPixel(buffer, bx - 1, by, wingA);
        setSolidPixel(buffer, bx + 1, by, wingA);
        setSolidPixel(buffer, bx, by + 1, body);
      } else {
        // Frame 1 (3x2): [., B, .] / [W, A, W]
        setSolidPixel(buffer, bx, by, body);
        setSolidPixel(buffer, bx - 1, by + 1, wingA);
        setSolidPixel(buffer, bx, by + 1, wingB);
        setSolidPixel(buffer, bx + 1, by + 1, wingA);
      }
    }
  }

  private renderSongbird(
    buffer: Uint8ClampedArray,
    palette: SpeciesPalette,
    timeSec: number
  ): void {
    if (this.bird.state === 'away') return;

    const bob =
      this.bird.state === 'perched' && Math.sin(timeSec * 3.2) > 0.75 ? 1 : 0;
    const px = Math.round(this.bird.x);
    const py = Math.round(this.bird.y) + bob;
    const dir = this.bird.facing;
    const birdPal = palette.bird;
    const flying = this.bird.state === 'flyingIn' || this.bird.state === 'flyingOut';
    const flapUp = Math.floor(timeSec * 12) % 2 === 0;

    // 5x4 bird sprite anchored so feet rest at py - 1
    const put = (dx: number, dy: number, col: Rgba): void => {
      setSolidPixel(buffer, px + dx * dir, py - 4 + dy, col);
    };

    // Row 0: crest (cardinal) + crown
    if (birdPal.crest) {
      put(-1, 0, birdPal.crest);
    }
    put(0, 0, birdPal.body);
    put(1, 0, birdPal.body);

    // Row 1: tail, back, eye, head, beak
    put(-2, 1, birdPal.wing);
    put(-1, 1, birdPal.body);
    put(0, 1, EYE_RGBA);
    put(1, 1, birdPal.body);
    put(2, 1, birdPal.beak);

    // Row 2: wing + belly
    if (flying && flapUp) {
      put(-2, 0, birdPal.wing);
      put(-1, 0, birdPal.wing);
      put(0, 2, birdPal.belly);
      put(1, 2, birdPal.belly);
    } else {
      put(-1, 2, birdPal.wing);
      put(0, 2, birdPal.wing);
      put(1, 2, birdPal.belly);
    }

    // Row 3: tiny perched feet
    if (!flying) {
      put(0, 3, EYE_RGBA);
    }

    // Occasional tiny pixel music note while perched
    if (this.bird.noteLife > 0) {
      const alpha = Math.min(1, this.bird.noteLife * 1.4);
      const nx = Math.round(this.bird.noteX);
      const ny = Math.round(this.bird.noteY);
      blendPixel(buffer, nx, ny, NOTE_RGBA, alpha);
      blendPixel(buffer, nx + 1, ny, NOTE_RGBA, alpha);
      blendPixel(buffer, nx, ny + 1, NOTE_RGBA, alpha);
      blendPixel(buffer, nx - 1, ny + 2, NOTE_RGBA, alpha);
      blendPixel(buffer, nx, ny + 2, NOTE_RGBA, alpha);
    }
  }

  private renderFireflies(buffer: Uint8ClampedArray, timeSec: number): void {
    if (!this.showFireflies) return;
    for (const f of this.fireflies) {
      const glow = 0.5 + 0.5 * Math.sin(timeSec * f.speed + f.phase);
      if (glow < 0.25) continue;
      const fx = Math.round(f.x);
      const fy = Math.round(f.y);
      blendPixel(buffer, fx, fy, FIREFLY_CORE, glow);
      if (glow > 0.72) {
        const haloAlpha = (glow - 0.72) * 2.5;
        blendPixel(buffer, fx - 1, fy, FIREFLY_HALO, haloAlpha);
        blendPixel(buffer, fx + 1, fy, FIREFLY_HALO, haloAlpha);
        blendPixel(buffer, fx, fy - 1, FIREFLY_HALO, haloAlpha);
        blendPixel(buffer, fx, fy + 1, FIREFLY_HALO, haloAlpha);
      }
    }
  }

  render(
    buffer: Uint8ClampedArray,
    skeleton: TreeSkeleton,
    palette: SpeciesPalette,
    progress: number,
    timeSec: number
  ): void {
    this.renderFireflies(buffer, timeSec);
    this.renderButterflies(buffer, skeleton, palette, progress, timeSec);
    this.renderSongbird(buffer, palette, timeSec);
  }
}
