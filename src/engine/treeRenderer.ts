import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../shared/types';
import { PALETTES, Rgba, SpeciesPalette } from './palettes';
import {
  BranchSegment,
  FoliageCluster,
  RootFlare,
  TreeAccent,
  TreeSkeleton,
} from './treeSkeleton';

const BAYER_2X2: readonly [readonly [number, number], readonly [number, number]] = [
  [0, 2],
  [3, 1],
];

// Pixel mask tags so outline & layering stay crisp.
const TAG_EMPTY = 0;
const TAG_POT = 1;
const TAG_BARK = 2;
const TAG_FOLIAGE = 3;
const TAG_ACCENT = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hash2D(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function setPixel(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  x: number,
  y: number,
  color: Rgba,
  tag: number
): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= VIRTUAL_WIDTH || iy < 0 || iy >= VIRTUAL_HEIGHT) return;
  const pIdx = iy * VIRTUAL_WIDTH + ix;
  tags[pIdx] = tag;
  const idx = pIdx * 4;
  buf[idx] = color[0];
  buf[idx + 1] = color[1];
  buf[idx + 2] = color[2];
  buf[idx + 3] = color[3];
}

/**
 * Computes integer-snapped horizontal wind sway in pixels.
 * Strictly zero when timeSec === 0 and rustleAmount === 0 so static previews are exact.
 */
export function computeSwayOffset(
  y: number,
  swayLayer: number,
  timeSec: number,
  rustleAmount = 0,
  phaseSeed = 0
): number {
  if (swayLayer <= 0) return 0;
  const rustle = Math.max(0, Math.min(1.5, rustleAmount));
  if (timeSec === 0 && rustle === 0) return 0;

  const heightWeight = clamp((90 - y) / 58, 0, 1);
  const layerWeight = swayLayer >= 2 ? 1 : 0.55;
  const weight = heightWeight * layerWeight;
  if (weight <= 0.05) return 0;

  const phase = (phaseSeed % 7) * 0.45;
  const idleWave = Math.sin(timeSec * 1.65 + phase);
  const rustleWave = rustle > 0 ? Math.sin(timeSec * 11.5 + phase * 2.1) * rustle * 0.95 : 0;
  const maxAmp = rustle > 0.05 ? 2 : 1;
  const offset = Math.round((idleWave * 0.85 + rustleWave) * weight);
  return clamp(offset, -maxAmp, maxAmp);
}

function drawPotAndSoil(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  skeleton: TreeSkeleton,
  pal: SpeciesPalette
): void {
  const pot = pal.pot;
  const cx = 48;

  if (pot.style === 'terracotta' || pot.style === 'slatePot') {
    // Soil mound inside pot opening (y = 90..92)
    for (let y = 90; y <= 92; y++) {
      const halfW = y === 90 ? 5 : y === 91 ? 8 : 9;
      for (let x = cx - halfW; x <= cx + halfW; x++) {
        const dx = (x - cx) / halfW;
        const h = hash2D(x, y, skeleton.seed);
        const shadeIdx = y === 90 && dx < 0.2 ? 2 : h > 0.62 && dx < 0.35 ? 2 : dx > 0.45 ? 0 : 1;
        setPixel(buf, tags, x, y, pot.soil[shadeIdx], TAG_POT);
      }
    }

    // Pot top rim (y = 91..93)
    for (let y = 91; y <= 93; y++) {
      const halfW = 11;
      for (let x = cx - halfW; x <= cx + halfW; x++) {
        // Leave inner soil visible on y=91..92
        if (y <= 92 && Math.abs(x - cx) <= (y === 91 ? 8 : 9)) {
          if (y === 92) {
            // Front rim lip overlaps soil front at y=92
          } else {
            continue;
          }
        }
        const t = (x - (cx - halfW)) / (halfW * 2);
        let shade: Rgba;
        if (y === 91) {
          shade = t < 0.4 ? pot.rimHighlight : t < 0.78 ? pot.shades[2] : pot.shades[1];
        } else if (y === 92) {
          shade = t < 0.18 ? pot.rimHighlight : t < 0.45 ? pot.shades[3] : t < 0.78 ? pot.shades[2] : pot.shades[1];
        } else {
          shade = t < 0.3 ? pot.shades[2] : t < 0.72 ? pot.shades[1] : pot.shades[0];
        }
        setPixel(buf, tags, x, y, shade, TAG_POT);
      }
    }

    // Tapered pot body (y = 94..105)
    for (let y = 94; y <= 105; y++) {
      const progressY = (y - 94) / 11;
      const halfW = Math.round(10 - progressY * 2);
      for (let x = cx - halfW; x <= cx + halfW; x++) {
        const t = (x - (cx - halfW)) / (halfW * 2);
        let shadeIdx: number;
        if (y === 94) {
          // Rim under-shadow
          shadeIdx = t < 0.25 ? 1 : 0;
        } else if (y === 105) {
          shadeIdx = t < 0.35 ? 1 : 0;
        } else if (t < 0.14) {
          shadeIdx = 2;
        } else if (t < 0.34) {
          shadeIdx = 3; // vertical specular highlight
        } else if (t < 0.68) {
          shadeIdx = 2;
        } else if (t < 0.88) {
          shadeIdx = 1;
        } else {
          shadeIdx = 0;
        }
        setPixel(buf, tags, x, y, pot.shades[shadeIdx], TAG_POT);
      }
    }
    return;
  }

  if (pot.style === 'stoneMound') {
    const moss = pot.detail ?? pot.soil;
    // Layered rocky alpine mound (x = 31..65, y = 91..105)
    const rocks: ReadonlyArray<{ rx: number; ry: number; cx: number; cy: number }> = [
      { cx: 38, cy: 100, rx: 7, ry: 5 },
      { cx: 58, cy: 100, rx: 7, ry: 5 },
      { cx: 48, cy: 99, rx: 12, ry: 6 },
      { cx: 48, cy: 94, rx: 9, ry: 3 },
    ];
    for (const rock of rocks) {
      const yStart = Math.floor(rock.cy - rock.ry);
      const yEnd = Math.min(105, Math.ceil(rock.cy + rock.ry));
      for (let y = yStart; y <= yEnd; y++) {
        for (let x = Math.floor(rock.cx - rock.rx); x <= Math.ceil(rock.cx + rock.rx); x++) {
          const nx = (x - rock.cx) / rock.rx;
          const ny = (y - rock.cy) / rock.ry;
          if (nx * nx + ny * ny <= 1.02) {
            const lit = 0.52 - nx * 0.35 - ny * 0.45 + (hash2D(x, y, skeleton.seed) - 0.5) * 0.14;
            const sIdx = clamp(Math.round(lit * 3), 0, 3);
            setPixel(buf, tags, x, y, pot.shades[sIdx], TAG_POT);
          }
        }
      }
    }
    // Soil cap at top of mound (y = 91..93)
    for (let y = 91; y <= 93; y++) {
      const halfW = y === 91 ? 5 : y === 92 ? 8 : 7;
      for (let x = cx - halfW; x <= cx + halfW; x++) {
        const sIdx = x < cx - 2 ? 2 : x > cx + 3 ? 0 : 1;
        setPixel(buf, tags, x, y, pot.soil[sIdx], TAG_POT);
      }
    }
    // Lush moss patches over stones
    const mossPatches: ReadonlyArray<readonly [number, number, number]> = [
      [37, 96, 3],
      [42, 95, 3],
      [54, 95, 3],
      [59, 97, 2.5],
      [48, 97, 2.5],
    ];
    for (const [mx, my, mr] of mossPatches) {
      for (let y = Math.floor(my - mr); y <= Math.ceil(my + mr); y++) {
        for (let x = Math.floor(mx - mr); x <= Math.ceil(mx + mr); x++) {
          const d2 = ((x - mx) * (x - mx) + (y - my) * (y - my)) / (mr * mr);
          if (d2 <= 1 && y <= 103) {
            const mIdx = y < my ? 2 : x > mx + 1 ? 0 : 1;
            setPixel(buf, tags, x, y, moss[mIdx], TAG_POT);
          }
        }
      }
    }
    return;
  }

  // ceramicTray (bonsai: wide shallow cobalt tray x=24..72, y=95..105)
  // Soil mound inside tray (x = 30..66, y = 91..95)
  for (let y = 91; y <= 95; y++) {
    const halfW = y === 91 ? 6 : y === 92 ? 12 : y === 93 ? 16 : 18;
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      const h = hash2D(x, y, skeleton.seed);
      const sIdx = y <= 92 && x < cx + 2 ? 2 : h > 0.65 && x < cx + 4 ? 2 : x > cx + 8 ? 0 : 1;
      setPixel(buf, tags, x, y, pot.soil[sIdx], TAG_POT);
    }
  }

  // Miniature zen stone on the tray
  if (skeleton.zenStone) {
    const stonePalette = pot.detail ?? pot.shades;
    const st = skeleton.zenStone;
    for (let y = Math.floor(st.y - st.ry); y <= Math.ceil(st.y + st.ry); y++) {
      for (let x = Math.floor(st.x - st.rx); x <= Math.ceil(st.x + st.rx); x++) {
        const nx = (x - st.x) / st.rx;
        const ny = (y - st.y) / st.ry;
        if (nx * nx + ny * ny <= 1.0 && y <= 95) {
          const sIdx = ny < -0.2 && nx < 0.2 ? 2 : nx > 0.35 || ny > 0.35 ? 0 : 1;
          setPixel(buf, tags, x, y, stonePalette[sIdx], TAG_POT);
        }
      }
    }
  }

  // Shallow cobalt ceramic tray rim & body (x = 24..72, y = 95..103)
  for (let y = 95; y <= 103; y++) {
    const xMin = y <= 96 ? 24 : y <= 102 ? 25 : 26;
    const xMax = y <= 96 ? 72 : y <= 102 ? 71 : 70;
    for (let x = xMin; x <= xMax; x++) {
      const t = (x - xMin) / (xMax - xMin);
      let shade: Rgba;
      if (y === 95) {
        shade = t < 0.45 ? pot.rimHighlight : t < 0.8 ? pot.shades[3] : pot.shades[2];
      } else if (y === 96) {
        shade = t < 0.25 ? pot.rimHighlight : t < 0.6 ? pot.shades[2] : pot.shades[1];
      } else if (y === 97 || y === 103) {
        shade = t < 0.28 ? pot.shades[1] : pot.shades[0];
      } else {
        if (t < 0.14) shade = pot.shades[2];
        else if (t < 0.32) shade = pot.shades[3];
        else if (t < 0.7) shade = pot.shades[2];
        else if (t < 0.88) shade = pot.shades[1];
        else shade = pot.shades[0];
      }
      setPixel(buf, tags, x, y, shade, TAG_POT);
    }
  }

  // Carved ceramic corner feet (y = 104..105)
  for (let y = 104; y <= 105; y++) {
    for (let x = 28; x <= 33; x++) {
      setPixel(buf, tags, x, y, x < 31 ? pot.shades[1] : pot.shades[0], TAG_POT);
    }
    for (let x = 63; x <= 68; x++) {
      setPixel(buf, tags, x, y, x < 66 ? pot.shades[1] : pot.shades[0], TAG_POT);
    }
  }
}

function drawSeed(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  skeleton: TreeSkeleton,
  pal: SpeciesPalette,
  timeSec: number,
  rustleAmount: number
): void {
  const cx = Math.round(skeleton.baseX);
  const sy = skeleton.soilY;
  const rustle = Math.max(0, Math.min(1.5, rustleAmount));
  const bounce =
    timeSec === 0 && rustle === 0
      ? 0
      : rustle > 0.05
        ? -Math.round(Math.abs(Math.sin(timeSec * 24)) * Math.min(1, rustle))
        : 0;

  const yTop = sy - 3 + bounce;
  // Plump 3x3 pixel seed peeking cleanly from the soil
  setPixel(buf, tags, cx, yTop, pal.pot.seed[1], TAG_ACCENT);
  setPixel(buf, tags, cx - 1, yTop + 1, pal.pot.seed[1], TAG_ACCENT);
  setPixel(buf, tags, cx, yTop + 1, pal.pot.seed[0], TAG_ACCENT);
  setPixel(buf, tags, cx + 1, yTop + 1, pal.pot.seed[0], TAG_ACCENT);
  setPixel(buf, tags, cx - 1, yTop + 2, pal.pot.seed[0], TAG_ACCENT);
  setPixel(buf, tags, cx, yTop + 2, pal.pot.seed[0], TAG_ACCENT);
  setPixel(buf, tags, cx + 1, yTop + 2, pal.pot.seed[0], TAG_ACCENT);

  // Subtle soil crumble during bounce
  if (bounce < 0) {
    setPixel(buf, tags, cx - 3, sy - 2, pal.pot.soil[2], TAG_POT);
    setPixel(buf, tags, cx + 3, sy - 2, pal.pot.soil[2], TAG_POT);
  }
}

function drawSprout(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  skeleton: TreeSkeleton,
  pal: SpeciesPalette,
  progress: number,
  timeSec: number,
  rustleAmount: number
): void {
  const t = clamp((progress - 0.03) / 0.09, 0, 1);
  const height = Math.round(5 + t * (skeleton.sprout.maxHeight - 5));
  const baseX = Math.round(skeleton.baseX);
  const baseY = skeleton.soilY;
  const swayDx = computeSwayOffset(baseY - height, 1, timeSec, rustleAmount, skeleton.seed);

  // Seed coat collar specks at base
  setPixel(buf, tags, baseX - 1, baseY, pal.pot.seed[0], TAG_BARK);
  setPixel(buf, tags, baseX + 1, baseY, pal.pot.seed[0], TAG_BARK);

  let tipX = baseX;
  for (let i = 0; i <= height; i++) {
    const frac = height > 0 ? i / height : 0;
    const curve = Math.round(Math.sin(frac * Math.PI * 0.85) * skeleton.sprout.curveDir * (1 + t));
    const sx = baseX + curve + Math.round(swayDx * frac);
    const sy = baseY - i;
    tipX = sx;
    setPixel(buf, tags, sx, sy, i < 2 ? pal.sprout[0] : pal.sprout[1], TAG_FOLIAGE);
  }

  const tipY = baseY - height;
  const leafSpan = Math.round(2 + t * (skeleton.sprout.leafSpread - 1));

  // Left & right cute cotyledon leaves
  for (let dx = 1; dx <= leafSpan; dx++) {
    setPixel(buf, tags, tipX - dx, tipY - (dx <= 2 ? 1 : 0), pal.sprout[2], TAG_FOLIAGE);
    setPixel(buf, tags, tipX - dx, tipY + (dx > 2 ? 1 : 0), pal.sprout[1], TAG_FOLIAGE);
    setPixel(buf, tags, tipX + dx, tipY - (dx <= 2 ? 1 : 0), pal.sprout[2], TAG_FOLIAGE);
    setPixel(buf, tags, tipX + dx, tipY + (dx > 2 ? 1 : 0), pal.sprout[1], TAG_FOLIAGE);
  }
  setPixel(buf, tags, tipX, tipY - 1, pal.sprout[2], TAG_FOLIAGE);
}

function drawBranchSegment(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  seg: BranchSegment,
  progress: number,
  pal: SpeciesPalette,
  seed: number,
  timeSec: number,
  rustleAmount: number
): void {
  if (progress < seg.revealAt) return;

  const minGrow = seg.isTrunk && seg.revealAt <= 0.13 ? 0.72 : 0.45;
  const lenGrow = clamp(
    minGrow + (1 - minGrow) * clamp((progress - seg.revealAt) / seg.growSpan, 0, 1),
    minGrow,
    1
  );
  const thicknessScale = 0.62 + 0.38 * clamp((progress - 0.12) / 0.65, 0, 1);

  const dx0 = computeSwayOffset(seg.y0, seg.swayLayer > 0 ? seg.swayLayer - 1 : 0, timeSec, rustleAmount, seed);
  const dx1 = computeSwayOffset(seg.y1, seg.swayLayer, timeSec, rustleAmount, seed);

  const x0 = seg.x0 + dx0;
  const y0 = seg.y0;
  const x1 = seg.x0 + (seg.x1 - seg.x0) * lenGrow + dx1 * lenGrow;
  const y1 = seg.y0 + (seg.y1 - seg.y0) * lenGrow;

  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist * 2));

  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const cx = x0 + (x1 - x0) * f;
    const cy = y0 + (y1 - y0) * f;
    const r = (seg.r0 + (seg.r1 - seg.r0) * f) * thicknessScale;
    const rCeil = Math.ceil(r);

    for (let oy = -rCeil; oy <= rCeil; oy++) {
      for (let ox = -rCeil; ox <= rCeil; ox++) {
        if (ox * ox + oy * oy <= r * r + 0.15) {
          const px = Math.round(cx + ox);
          const py = Math.round(cy + oy);
          const normX = r > 0.4 ? ox / r : 0;
          const grain = hash2D(Math.round(ox), py, seed);
          let bIdx: number;
          if (normX < -0.45) {
            bIdx = grain > 0.3 ? 3 : 2;
          } else if (normX < 0.1) {
            bIdx = grain > 0.65 ? 2 : 1;
          } else if (normX < 0.55) {
            bIdx = 1;
          } else {
            bIdx = 0;
          }
          setPixel(buf, tags, px, py, pal.bark[bIdx], TAG_BARK);
        }
      }
    }
  }
}

function drawRootFlare(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  flare: RootFlare,
  progress: number,
  pal: SpeciesPalette
): void {
  if (progress < flare.revealAt) return;
  const grow = 0.5 + 0.5 * clamp((progress - flare.revealAt) / 0.10, 0, 1);
  const x1 = flare.x0 + (flare.x1 - flare.x0) * grow;
  const y1 = flare.y0 + (flare.y1 - flare.y0) * grow;
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - flare.x0, y1 - flare.y0) * 2));

  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const cx = flare.x0 + (x1 - flare.x0) * f;
    const cy = flare.y0 + (y1 - flare.y0) * f;
    const r = flare.r0 + (flare.r1 - flare.r0) * f;
    const rc = Math.ceil(r);
    for (let oy = -rc; oy <= rc; oy++) {
      for (let ox = -rc; ox <= rc; ox++) {
        if (ox * ox + oy * oy <= r * r + 0.1) {
          const bIdx = ox < 0 ? 2 : ox > 0 ? 0 : 1;
          setPixel(buf, tags, cx + ox, cy + oy, pal.bark[bIdx], TAG_BARK);
        }
      }
    }
  }
}

function drawFoliageCluster(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  cluster: FoliageCluster,
  progress: number,
  pal: SpeciesPalette,
  timeSec: number,
  rustleAmount: number
): void {
  if (progress < cluster.revealAt) return;
  if (cluster.shedAt !== undefined && progress >= cluster.shedAt) return;

  const grow = 0.45 + 0.55 * clamp((progress - cluster.revealAt) / cluster.growSpan, 0, 1);
  const rx = Math.max(1.5, cluster.rx * grow);
  const ry = Math.max(1.5, cluster.ry * grow);
  const swayDx = computeSwayOffset(cluster.y, cluster.swayLayer, timeSec, rustleAmount, cluster.id);
  const cx = cluster.x + swayDx;
  const cy = cluster.y;

  const minX = Math.floor(cx - rx - 1);
  const maxX = Math.ceil(cx + rx + 1);
  const minY = Math.floor(cy - ry - 1);
  const maxY = Math.ceil(cy + ry + 1);

  const heightBonus = clamp((65 - cluster.y) / 60, 0, 1) * 0.16;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Local offsets stay locked to the cluster during sway so pixels never crawl
      const lx = px - cx;
      const ly = py - cy;
      const nx = lx / rx;
      const ny = ly / ry;

      // Angular-quantized radial scallop guarantees star-shaped connectivity (0 detached 1px dots)
      const sector = Math.round((Math.atan2(ny, nx) + Math.PI) * 2.2);
      const edgeNoise = hash2D(sector, cluster.id, 17) * 0.13;
      let inside = false;

      if (cluster.shape === 'puff') {
        inside = nx * nx + ny * ny <= 1.02 - edgeNoise;
      } else if (cluster.shape === 'cloudPad') {
        // Sculpted bonsai horizontal pad: domed top, flat trimmed bottom
        if (ny <= 0.05) {
          inside = nx * nx + ny * ny <= 1.02 - edgeNoise * 0.6;
        } else if (ny <= 0.48 - edgeNoise * 0.25) {
          inside = Math.abs(nx) <= 0.96 - ny * 0.2;
        }
      } else {
        // 'pineBough': conical spruce wedge with serrated needle bottom
        if (ny >= -0.95 && ny <= 0.92) {
          const tDown = (ny + 0.95) / 1.87;
          const maxHalf = 0.25 + 0.78 * tDown;
          const teeth = ((Math.round(lx) + cluster.id) & 1) === 0 ? 0.16 : -0.14;
          if (Math.abs(nx) <= maxHalf && ny <= 0.74 + teeth) {
            inside = true;
          }
        }
      }

      if (!inside) continue;

      const bayer = BAYER_2X2[Math.abs(Math.round(ly)) & 1][Math.abs(Math.round(lx)) & 1];
      const bayerOffset = (bayer - 1.5) * 0.09;
      const lit =
        0.52 -
        nx * 0.34 -
        ny * 0.44 +
        cluster.toneBias +
        heightBonus +
        bayerOffset;
      const shadeIdx = clamp(Math.round(lit * 3.1), 0, 3);
      setPixel(buf, tags, px, py, pal.foliage[shadeIdx], TAG_FOLIAGE);
    }
  }
}

function drawAccent(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  accent: TreeAccent,
  progress: number,
  pal: SpeciesPalette,
  timeSec: number,
  rustleAmount: number
): void {
  if (progress < accent.revealAt) return;
  const swayDx = computeSwayOffset(accent.y, accent.swayLayer, timeSec, rustleAmount, accent.id);
  const x = Math.round(accent.x + swayDx);
  const y = Math.round(accent.y);

  switch (accent.kind) {
    case 'acorn': {
      setPixel(buf, tags, x, y, pal.secondaryAccents[0], TAG_ACCENT);
      setPixel(buf, tags, x + 1, y, pal.secondaryAccents[1], TAG_ACCENT);
      setPixel(buf, tags, x, y + 1, pal.accents[1], TAG_ACCENT);
      setPixel(buf, tags, x + 1, y + 1, pal.accents[0], TAG_ACCENT);
      setPixel(buf, tags, x, y + 2, pal.accents[0], TAG_ACCENT);
      break;
    }
    case 'blossom': {
      const col = pal.accents[accent.colorIndex % pal.accents.length];
      setPixel(buf, tags, x, y, col, TAG_ACCENT);
      if (accent.size >= 2) {
        setPixel(buf, tags, x - 1, y, col, TAG_ACCENT);
        setPixel(buf, tags, x + 1, y, col, TAG_ACCENT);
        setPixel(buf, tags, x, y - 1, col, TAG_ACCENT);
        setPixel(buf, tags, x, y + 1, pal.secondaryAccents[0], TAG_ACCENT);
      }
      break;
    }
    case 'snow': {
      setPixel(buf, tags, x, y, pal.accents[2], TAG_ACCENT);
      setPixel(buf, tags, x - 1, y + 1, pal.accents[1], TAG_ACCENT);
      setPixel(buf, tags, x, y + 1, pal.accents[1], TAG_ACCENT);
      if (accent.size >= 3) {
        setPixel(buf, tags, x + 1, y + 1, pal.accents[0], TAG_ACCENT);
      }
      break;
    }
    case 'pinecone': {
      setPixel(buf, tags, x, y, pal.secondaryAccents[1], TAG_ACCENT);
      setPixel(buf, tags, x + 1, y, pal.secondaryAccents[0], TAG_ACCENT);
      setPixel(buf, tags, x, y + 1, pal.secondaryAccents[0], TAG_ACCENT);
      setPixel(buf, tags, x + 1, y + 1, pal.secondaryAccents[1], TAG_ACCENT);
      setPixel(buf, tags, x, y + 2, pal.secondaryAccents[0], TAG_ACCENT);
      break;
    }
    case 'mapleLeaf': {
      const col = pal.accents[accent.colorIndex % pal.accents.length];
      setPixel(buf, tags, x, y, col, TAG_ACCENT);
      if (accent.size >= 2) {
        setPixel(buf, tags, x + 1, y, col, TAG_ACCENT);
        setPixel(buf, tags, x, y + 1, pal.secondaryAccents[accent.colorIndex % pal.secondaryAccents.length], TAG_ACCENT);
      }
      break;
    }
    case 'bonsaiBloom': {
      const col = pal.accents[accent.colorIndex % pal.accents.length];
      setPixel(buf, tags, x, y, col, TAG_ACCENT);
      setPixel(buf, tags, x + 1, y, pal.accents[(accent.colorIndex + 1) % 2], TAG_ACCENT);
      break;
    }
  }
}

function drawAncientShimmer(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  skeleton: TreeSkeleton,
  pal: SpeciesPalette,
  progress: number,
  timeSec: number,
  rustleAmount: number
): void {
  if (progress < 0.98) return;
  const anchors = skeleton.foliageClusters.slice(-3);
  anchors.forEach((cluster, idx) => {
    const pulse =
      timeSec === 0
        ? idx < 2
          ? 1
          : 0
        : Math.sin(timeSec * 3.8 + idx * 2.1);
    if (pulse > 0.35) {
      const swayDx = computeSwayOffset(cluster.y, cluster.swayLayer, timeSec, rustleAmount, cluster.id);
      const sx = Math.round(cluster.x + swayDx - 1 + idx);
      const sy = Math.round(cluster.y - Math.max(1, cluster.ry * 0.45));
      const col = pal.particles.shimmer[idx % pal.particles.shimmer.length];
      setPixel(buf, tags, sx, sy, col, TAG_ACCENT);
    }
  });
}

function applyOutlinePass(
  buf: Uint8ClampedArray,
  tags: Uint8Array,
  outlineColor: Rgba
): void {
  for (let y = 0; y < VIRTUAL_HEIGHT; y++) {
    const rowOffset = y * VIRTUAL_WIDTH;
    for (let x = 0; x < VIRTUAL_WIDTH; x++) {
      const pIdx = rowOffset + x;
      if (tags[pIdx] !== TAG_EMPTY) continue;

      const hasNeighbor =
        (x > 0 && tags[pIdx - 1] !== TAG_EMPTY) ||
        (x < VIRTUAL_WIDTH - 1 && tags[pIdx + 1] !== TAG_EMPTY) ||
        (y > 0 && tags[pIdx - VIRTUAL_WIDTH] !== TAG_EMPTY) ||
        (y < VIRTUAL_HEIGHT - 1 && tags[pIdx + VIRTUAL_WIDTH] !== TAG_EMPTY);

      if (hasNeighbor) {
        const idx = pIdx * 4;
        buf[idx] = outlineColor[0];
        buf[idx + 1] = outlineColor[1];
        buf[idx + 2] = outlineColor[2];
        buf[idx + 3] = outlineColor[3];
      }
    }
  }
}

/**
 * Pure Node-safe pixel-buffer renderer on a 96 x 112 RGBA grid.
 */
export function renderTreeToBuffer(
  skeleton: TreeSkeleton,
  progress: number,
  timeSec: number,
  rustleAmount = 0
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(VIRTUAL_WIDTH * VIRTUAL_HEIGHT * 4);
  const tags = new Uint8Array(VIRTUAL_WIDTH * VIRTUAL_HEIGHT);
  const pal = PALETTES[skeleton.species];
  const p = clamp(progress, 0, 1);

  // 1. Pot / stone mound / ceramic tray & soil
  drawPotAndSoil(buf, tags, skeleton, pal);

  // 2. Stage-specific tree anatomy
  if (p < 0.03) {
    drawSeed(buf, tags, skeleton, pal, timeSec, rustleAmount);
  } else if (p < 0.12) {
    drawSprout(buf, tags, skeleton, pal, p, timeSec, rustleAmount);
  } else {
    // Trunk & primary/secondary branches
    for (const seg of skeleton.trunkSegments) {
      drawBranchSegment(buf, tags, seg, p, pal, skeleton.seed, timeSec, rustleAmount);
    }
    for (const flare of skeleton.rootFlares) {
      drawRootFlare(buf, tags, flare, p, pal);
    }
    for (const br of skeleton.branches) {
      drawBranchSegment(buf, tags, br, p, pal, skeleton.seed, timeSec, rustleAmount);
    }
    // Foliage clusters (back-to-front)
    for (const cluster of skeleton.foliageClusters) {
      drawFoliageCluster(buf, tags, cluster, p, pal, timeSec, rustleAmount);
    }
    // Mature species accents
    for (const accent of skeleton.accents) {
      drawAccent(buf, tags, accent, p, pal, timeSec, rustleAmount);
    }
    // Ancient golden shimmer
    drawAncientShimmer(buf, tags, skeleton, pal, p, timeSec, rustleAmount);
  }

  // 3. Crisp 1px dark silhouette outline around tree+pot so widget pops on light & dark wallpapers
  applyOutlinePass(buf, tags, pal.outline);

  return buf;
}

/**
 * Checks whether any pixel within `radius` virtual pixels of (vx, vy) is opaque.
 */
export function isPixelOpaque(
  buffer: Uint8ClampedArray,
  vx: number,
  vy: number,
  radius = 0
): boolean {
  const cx = Math.floor(vx);
  const cy = Math.floor(vy);
  const r = Math.max(0, Math.floor(radius));

  if (r === 0) {
    if (cx < 0 || cx >= VIRTUAL_WIDTH || cy < 0 || cy >= VIRTUAL_HEIGHT) return false;
    return buffer[(cy * VIRTUAL_WIDTH + cx) * 4 + 3] > 0;
  }

  const r2 = r * r;
  const xMin = Math.max(0, cx - r);
  const xMax = Math.min(VIRTUAL_WIDTH - 1, cx + r);
  const yMin = Math.max(0, cy - r);
  const yMax = Math.min(VIRTUAL_HEIGHT - 1, cy + r);

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) {
        if (buffer[(y * VIRTUAL_WIDTH + x) * 4 + 3] > 0) {
          return true;
        }
      }
    }
  }
  return false;
}
