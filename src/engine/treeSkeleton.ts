import { SpeciesId, VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../shared/types';
import { PotStyle } from './palettes';
import { createPrng, Prng } from './prng';

export interface BranchSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r0: number;
  r1: number;
  revealAt: number;
  growSpan: number;
  swayLayer: number;
  isTrunk?: boolean;
}

export interface RootFlare {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r0: number;
  r1: number;
  revealAt: number;
}

export type ClusterShape = 'puff' | 'pineBough' | 'cloudPad';

export interface FoliageCluster {
  id: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
  shape: ClusterShape;
  revealAt: number;
  growSpan: number;
  /** Optional progress at which temporary lower-stem sapling tufts shed cleanly as upper canopy takes over. */
  shedAt?: number;
  swayLayer: number;
  /** Depth order: smaller renders behind larger. */
  depth: number;
  /** Shifts lighting/palette bias in [-0.35, 0.35]. */
  toneBias: number;
}

export type AccentKind =
  | 'acorn'
  | 'blossom'
  | 'snow'
  | 'pinecone'
  | 'mapleLeaf'
  | 'bonsaiBloom';

export interface TreeAccent {
  id: number;
  kind: AccentKind;
  x: number;
  y: number;
  size: number;
  revealAt: number;
  swayLayer: number;
  colorIndex: number;
}

export interface PerchPoint {
  x: number;
  y: number;
  facing: -1 | 1;
  revealAt: number;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface TreeSkeleton {
  species: SpeciesId;
  seed: number;
  baseX: number;
  soilY: number;
  potBottomY: number;
  potStyle: PotStyle;
  potBounds: Bounds;
  zenStone?: { x: number; y: number; rx: number; ry: number };
  sprout: {
    curveDir: -1 | 1;
    maxHeight: number;
    leafSpread: number;
  };
  trunkSegments: BranchSegment[];
  branches: BranchSegment[];
  rootFlares: RootFlare[];
  foliageClusters: FoliageCluster[];
  accents: TreeAccent[];
  perches: PerchPoint[];
  canopyBounds: Bounds;
}

const MIN_TREE_X = 7;
const MAX_TREE_X = VIRTUAL_WIDTH - 8; // 88
const MIN_TREE_Y = 14; // leaves headroom up to y=8..13 for crowns & perched birds

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampCluster(c: FoliageCluster): FoliageCluster {
  const rx = clamp(c.rx, 2, 13);
  const ry = clamp(c.ry, 2, 10);
  const x = clamp(c.x, MIN_TREE_X + rx, MAX_TREE_X - rx);
  const y = clamp(c.y, MIN_TREE_Y + ry, 88 - ry);
  return { ...c, x, y, rx, ry };
}

function computeCanopyBounds(clusters: readonly FoliageCluster[], fallbackX: number, fallbackY: number): Bounds {
  if (clusters.length === 0) {
    return { xMin: fallbackX - 8, xMax: fallbackX + 8, yMin: fallbackY - 16, yMax: fallbackY - 4 };
  }
  let xMin = VIRTUAL_WIDTH;
  let xMax = 0;
  let yMin = VIRTUAL_HEIGHT;
  let yMax = 0;
  for (const c of clusters) {
    xMin = Math.min(xMin, Math.floor(c.x - c.rx));
    xMax = Math.max(xMax, Math.ceil(c.x + c.rx));
    yMin = Math.min(yMin, Math.floor(c.y - c.ry));
    yMax = Math.max(yMax, Math.ceil(c.y + c.ry));
  }
  return {
    xMin: clamp(xMin, 4, VIRTUAL_WIDTH - 5),
    xMax: clamp(xMax, 4, VIRTUAL_WIDTH - 5),
    yMin: clamp(yMin, 10, VIRTUAL_HEIGHT - 20),
    yMax: clamp(yMax, 12, VIRTUAL_HEIGHT - 16),
  };
}

function addSegmentedLimb(
  target: BranchSegment[],
  points: ReadonlyArray<readonly [number, number]>,
  rStart: number,
  rEnd: number,
  revealStart: number,
  revealEnd: number,
  swayStart: number,
  swayEnd: number,
  isTrunk = false,
  growSpan = 0.06
): void {
  const count = points.length - 1;
  for (let i = 0; i < count; i++) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    target.push({
      x0: clamp(points[i][0], 14, VIRTUAL_WIDTH - 15),
      y0: clamp(points[i][1], MIN_TREE_Y + 4, 95),
      x1: clamp(points[i + 1][0], 14, VIRTUAL_WIDTH - 15),
      y1: clamp(points[i + 1][1], MIN_TREE_Y + 4, 95),
      r0: rStart + (rEnd - rStart) * t0,
      r1: rStart + (rEnd - rStart) * t1,
      revealAt: revealStart + (revealEnd - revealStart) * t0,
      growSpan,
      swayLayer: Math.round(swayStart + (swayEnd - swayStart) * t1),
      isTrunk,
    });
  }
}

function buildOakSkeleton(rng: Prng): TreeSkeleton {
  const baseX = 48;
  const soilY = 92;
  const potBottomY = 105;
  const lean = rng.range(-3.0, 3.0);

  const trunkSegments: BranchSegment[] = [];
  const branches: BranchSegment[] = [];
  const rootFlares: RootFlare[] = [
    { x0: baseX - 1, y0: soilY - 4, x1: baseX - 6, y1: soilY + 1, r0: 1.8, r1: 0.9, revealAt: 0.62 },
    { x0: baseX + 1, y0: soilY - 4, x1: baseX + 6, y1: soilY + 1, r0: 1.8, r1: 0.9, revealAt: 0.65 },
    { x0: baseX, y0: soilY - 3, x1: baseX + rng.range(-2, 2), y1: soilY + 1, r0: 1.5, r1: 0.8, revealAt: 0.68 },
  ];

  // Seg 0: 0.12..0.16, Seg 1: 0.16..0.21, Seg 2: 0.20..0.25 -> reaches fork at 0.25
  addSegmentedLimb(
    trunkSegments,
    [
      [baseX, soilY],
      [baseX + lean * 0.25, 79],
      [baseX + lean * 0.65, 65],
      [baseX + lean, 51],
    ],
    3.5,
    1.9,
    0.12,
    0.24,
    0,
    1,
    true,
    0.05
  );

  const forkX = baseX + lean;
  const forkY = 53;

  // Wide oak spreading boughs (outermost twigs extend cleanly alongside full canopy)
  addSegmentedLimb(
    branches,
    [
      [forkX - 1, forkY + 2],
      [forkX - 11, forkY - 4],
      [forkX - 21, forkY - 10],
    ],
    1.8,
    0.85,
    0.25,
    0.52,
    1,
    2,
    false,
    0.08
  );
  addSegmentedLimb(
    branches,
    [
      [forkX + 1, forkY + 2],
      [forkX + 12, forkY - 5],
      [forkX + 22, forkY - 11],
    ],
    1.8,
    0.85,
    0.25,
    0.52,
    1,
    2,
    false,
    0.08
  );
  addSegmentedLimb(
    branches,
    [
      [forkX, forkY],
      [forkX - 7, 38],
      [forkX - 13, 28],
    ],
    1.5,
    0.8,
    0.34,
    0.58,
    1,
    2,
    false,
    0.08
  );
  addSegmentedLimb(
    branches,
    [
      [forkX, forkY],
      [forkX + 7, 37],
      [forkX + 14, 27],
    ],
    1.5,
    0.8,
    0.36,
    0.60,
    1,
    2,
    false,
    0.08
  );
  addSegmentedLimb(
    branches,
    [
      [forkX, forkY],
      [forkX + rng.range(-2, 2), 36],
      [forkX + rng.range(-3, 3), 24],
    ],
    1.5,
    0.75,
    0.40,
    0.64,
    1,
    2,
    false,
    0.08
  );

  let cid = 1;
  const rawClusters: FoliageCluster[] = [
    // Temporary lower-trunk sapling tufts (shed cleanly as young canopy expands)
    { id: cid++, x: baseX + lean * 0.18, y: 82, rx: 3.5, ry: 3, shape: 'puff', revealAt: 0.12, growSpan: 0.06, shedAt: 0.32, swayLayer: 1, depth: 2, toneBias: 0.08 },
    { id: cid++, x: baseX + lean * 0.65, y: 65, rx: 3.5, ry: 3, shape: 'puff', revealAt: 0.21, growSpan: 0.06, shedAt: 0.36, swayLayer: 1, depth: 2, toneBias: 0.1 },
    // Crown fork tuft (stays tucked inside mature canopy base)
    { id: cid++, x: forkX - 3, y: 52, rx: 4.5, ry: 3.5, shape: 'puff', revealAt: 0.25, growSpan: 0.07, swayLayer: 1, depth: 3, toneBias: -0.05 },

    // Young inner canopy
    { id: cid++, x: forkX, y: 45, rx: 8.5, ry: 6, shape: 'puff', revealAt: 0.32, growSpan: 0.09, swayLayer: 1, depth: 1, toneBias: -0.15 },
    { id: cid++, x: forkX - 12, y: 46, rx: 7.5, ry: 5.5, shape: 'puff', revealAt: 0.36, growSpan: 0.09, swayLayer: 2, depth: 2, toneBias: -0.1 },
    { id: cid++, x: forkX + 12, y: 45, rx: 7.5, ry: 5.5, shape: 'puff', revealAt: 0.40, growSpan: 0.09, swayLayer: 2, depth: 2, toneBias: 0.0 },
    { id: cid++, x: forkX - 6, y: 34, rx: 8, ry: 6, shape: 'puff', revealAt: 0.46, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.12 },
    { id: cid++, x: forkX + 7, y: 33, rx: 8, ry: 6, shape: 'puff', revealAt: 0.52, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.08 },

    // Full wide sturdy oak dome
    { id: cid++, x: forkX - 20, y: 43, rx: 8.5, ry: 6, shape: 'puff', revealAt: 0.62, growSpan: 0.09, swayLayer: 2, depth: 1, toneBias: -0.18 },
    { id: cid++, x: forkX + 20, y: 42, rx: 8.5, ry: 6, shape: 'puff', revealAt: 0.65, growSpan: 0.09, swayLayer: 2, depth: 1, toneBias: -0.08 },
    { id: cid++, x: forkX - 15, y: 32, rx: 8.5, ry: 6.5, shape: 'puff', revealAt: 0.69, growSpan: 0.09, swayLayer: 2, depth: 4, toneBias: 0.05 },
    { id: cid++, x: forkX + 15, y: 31, rx: 8.5, ry: 6.5, shape: 'puff', revealAt: 0.72, growSpan: 0.09, swayLayer: 2, depth: 4, toneBias: 0.02 },
    { id: cid++, x: forkX, y: 26, rx: 10, ry: 6.5, shape: 'puff', revealAt: 0.76, growSpan: 0.09, swayLayer: 2, depth: 5, toneBias: 0.2 },
    { id: cid++, x: forkX - 9, y: 23, rx: 7.5, ry: 5.5, shape: 'puff', revealAt: 0.80, growSpan: 0.08, swayLayer: 2, depth: 5, toneBias: 0.22 },
    { id: cid++, x: forkX + 9, y: 24, rx: 7.5, ry: 5.5, shape: 'puff', revealAt: 0.84, growSpan: 0.08, swayLayer: 2, depth: 5, toneBias: 0.16 },

    // Ancient outer lush highlights (extends silhouette so ancient > full pixels)
    { id: cid++, x: forkX - 25, y: 40, rx: 6, ry: 4.5, shape: 'puff', revealAt: 0.90, growSpan: 0.05, swayLayer: 2, depth: 4, toneBias: 0.08 },
    { id: cid++, x: forkX + 25, y: 39, rx: 6, ry: 4.5, shape: 'puff', revealAt: 0.92, growSpan: 0.05, swayLayer: 2, depth: 4, toneBias: 0.12 },
    { id: cid++, x: forkX + rng.range(-3, 3), y: 19, rx: 7, ry: 4.5, shape: 'puff', revealAt: 0.94, growSpan: 0.05, swayLayer: 2, depth: 6, toneBias: 0.28 },
  ];

  // Subtle organic seed variation
  const foliageClusters = rawClusters
    .map((c) =>
      clampCluster({
        ...c,
        x: c.x + rng.range(-1.0, 1.0),
        y: c.y + rng.range(-0.8, 0.8),
      })
    )
    .sort((a, b) => a.depth - b.depth);

  // Golden acorns hanging directly under oak dome boughs
  let aid = 1;
  const acornOffsets = [-17, -10, -4, 6, 13, 19];
  const accents: TreeAccent[] = acornOffsets.map((dx, i) => ({
    id: aid++,
    kind: 'acorn',
    x: clamp(Math.round(forkX + dx + rng.range(-1, 1)), 16, 80),
    y: clamp(Math.round(46 + (i % 2) * 2 + rng.range(-1, 1)), 43, 51),
    size: 2,
    revealAt: i < 2 ? 0.74 + i * 0.06 : 0.90 + (i - 2) * 0.02,
    swayLayer: 2,
    colorIndex: i % 2,
  }));

  const topCluster = foliageClusters[foliageClusters.length - 1];
  const perches: PerchPoint[] = [
    { x: Math.round(topCluster.x + 2), y: Math.round(topCluster.y - topCluster.ry), facing: -1, revealAt: 0.88 },
    { x: Math.round(forkX + 22), y: Math.round(forkY - 12), facing: -1, revealAt: 0.72 },
    { x: Math.round(forkX - 18), y: 27, facing: 1, revealAt: 0.76 },
  ];

  return {
    species: 'oak',
    seed: rng.intRange(1, 0x7fffffff),
    baseX,
    soilY,
    potBottomY,
    potStyle: 'terracotta',
    potBounds: { xMin: 37, xMax: 59, yMin: 91, yMax: 105 },
    sprout: { curveDir: rng.chance(0.5) ? -1 : 1, maxHeight: 14, leafSpread: 4 },
    trunkSegments,
    branches,
    rootFlares,
    foliageClusters,
    accents,
    perches,
    canopyBounds: computeCanopyBounds(foliageClusters, baseX, 40),
  };
}

function buildSakuraSkeleton(rng: Prng): TreeSkeleton {
  const baseX = 48;
  const soilY = 92;
  const potBottomY = 105;
  const dir: -1 | 1 = rng.chance(0.5) ? 1 : -1;

  const trunkSegments: BranchSegment[] = [];
  const branches: BranchSegment[] = [];
  const rootFlares: RootFlare[] = [
    { x0: baseX - 1, y0: soilY - 3, x1: baseX - 5, y1: soilY + 1, r0: 1.6, r1: 0.8, revealAt: 0.62 },
    { x0: baseX + 1, y0: soilY - 3, x1: baseX + 5, y1: soilY + 1, r0: 1.6, r1: 0.8, revealAt: 0.66 },
  ];

  // Graceful leaning trunk (Seg 0: 0.12..0.16, Seg 1: 0.17..0.22, Seg 2: 0.22..0.27)
  const bendX = baseX + dir * rng.range(6, 9);
  const topX = baseX + dir * rng.range(2, 5);
  addSegmentedLimb(
    trunkSegments,
    [
      [baseX, soilY],
      [baseX + dir * 3.5, 79],
      [bendX, 65],
      [topX, 50],
    ],
    3.1,
    1.6,
    0.12,
    0.27,
    0,
    1,
    true,
    0.05
  );

  // Sweeping asymmetric sakura boughs (outermost twigs extend alongside full clouds)
  addSegmentedLimb(
    branches,
    [
      [bendX - dir * 1, 61],
      [baseX - dir * 10, 52],
      [baseX - dir * 22, 46],
      [baseX - dir * 28, 49],
    ],
    1.6,
    0.7,
    0.24,
    0.54,
    1,
    2,
    false,
    0.07
  );
  addSegmentedLimb(
    branches,
    [
      [topX, 50],
      [topX + dir * 11, 41],
      [topX + dir * 21, 36],
    ],
    1.5,
    0.75,
    0.28,
    0.52,
    1,
    2,
    false,
    0.07
  );
  addSegmentedLimb(
    branches,
    [
      [topX, 50],
      [topX - dir * 7, 36],
      [topX - dir * 14, 27],
    ],
    1.4,
    0.7,
    0.34,
    0.60,
    1,
    2,
    false,
    0.07
  );
  addSegmentedLimb(
    branches,
    [
      [topX, 46],
      [topX + dir * 4, 32],
      [topX + dir * 2, 23],
    ],
    1.3,
    0.65,
    0.42,
    0.62,
    1,
    2,
    false,
    0.07
  );

  let cid = 1;
  const rawClusters: FoliageCluster[] = [
    // Temporary sapling tufts (shed cleanly once young clouds bloom)
    { id: cid++, x: baseX + dir * 2.5, y: 82, rx: 3.5, ry: 2.5, shape: 'puff', revealAt: 0.12, growSpan: 0.06, shedAt: 0.32, swayLayer: 1, depth: 2, toneBias: 0.1 },
    { id: cid++, x: bendX - dir * 1, y: 64, rx: 4, ry: 3, shape: 'puff', revealAt: 0.22, growSpan: 0.06, shedAt: 0.38, swayLayer: 1, depth: 2, toneBias: 0.05 },
    { id: cid++, x: baseX - dir * 8, y: 52, rx: 5, ry: 3.2, shape: 'puff', revealAt: 0.29, growSpan: 0.07, swayLayer: 1, depth: 3, toneBias: 0.12 },

    // Young airy blossom clouds
    { id: cid++, x: topX + dir * 6, y: 42, rx: 7.5, ry: 4.5, shape: 'puff', revealAt: 0.32, growSpan: 0.09, swayLayer: 1, depth: 2, toneBias: 0.0 },
    { id: cid++, x: baseX - dir * 16, y: 46, rx: 8, ry: 4.5, shape: 'puff', revealAt: 0.38, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.08 },
    { id: cid++, x: topX - dir * 6, y: 34, rx: 8, ry: 5, shape: 'puff', revealAt: 0.44, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.15 },
    { id: cid++, x: topX + dir * 15, y: 36, rx: 7.5, ry: 4.5, shape: 'puff', revealAt: 0.52, growSpan: 0.09, swayLayer: 2, depth: 4, toneBias: 0.1 },

    // Full graceful cloud canopy
    { id: cid++, x: baseX - dir * 25, y: 45, rx: 8.5, ry: 4.5, shape: 'puff', revealAt: 0.62, growSpan: 0.09, swayLayer: 2, depth: 2, toneBias: 0.02 },
    { id: cid++, x: topX + dir * 22, y: 35, rx: 7.5, ry: 4.5, shape: 'puff', revealAt: 0.66, growSpan: 0.09, swayLayer: 2, depth: 2, toneBias: 0.12 },
    { id: cid++, x: topX + dir * 2, y: 24, rx: 10, ry: 5, shape: 'puff', revealAt: 0.72, growSpan: 0.09, swayLayer: 2, depth: 5, toneBias: 0.22 },
    { id: cid++, x: topX - dir * 13, y: 27, rx: 8, ry: 4.5, shape: 'puff', revealAt: 0.77, growSpan: 0.09, swayLayer: 2, depth: 4, toneBias: 0.18 },
    { id: cid++, x: topX + dir * 11, y: 26, rx: 7.5, ry: 4.5, shape: 'puff', revealAt: 0.82, growSpan: 0.08, swayLayer: 2, depth: 5, toneBias: 0.2 },

    // Ancient weeping/outer blossom puffs
    { id: cid++, x: baseX - dir * 29, y: 49, rx: 5.5, ry: 4, shape: 'puff', revealAt: 0.90, growSpan: 0.05, swayLayer: 2, depth: 5, toneBias: 0.2 },
    { id: cid++, x: topX + dir * 2, y: 19, rx: 7, ry: 4, shape: 'puff', revealAt: 0.92, growSpan: 0.05, swayLayer: 2, depth: 6, toneBias: 0.3 },
    { id: cid++, x: topX + dir * 25, y: 39, rx: 5, ry: 3.5, shape: 'puff', revealAt: 0.94, growSpan: 0.05, swayLayer: 2, depth: 5, toneBias: 0.15 },
  ];

  const foliageClusters = rawClusters
    .map((c) =>
      clampCluster({
        ...c,
        x: c.x + rng.range(-1.2, 1.2),
        y: c.y + rng.range(-0.8, 0.8),
      })
    )
    .sort((a, b) => a.depth - b.depth);

  // Cream & bright rose blossoms across the canopy
  let aid = 1;
  const accents: TreeAccent[] = [];
  for (let i = 0; i < 12; i++) {
    const cluster = foliageClusters[(i * 3 + 4) % foliageClusters.length];
    accents.push({
      id: aid++,
      kind: 'blossom',
      x: clamp(Math.round(cluster.x + rng.range(-cluster.rx * 0.6, cluster.rx * 0.6)), 12, 84),
      y: clamp(Math.round(cluster.y + rng.range(-cluster.ry * 0.55, cluster.ry * 0.55)), 16, 56),
      size: i % 3 === 0 ? 2 : 1,
      revealAt: i < 4 ? 0.68 + i * 0.05 : 0.90 + ((i - 4) * 0.08) / 8,
      swayLayer: cluster.swayLayer,
      colorIndex: i % 3,
    });
  }

  const perches: PerchPoint[] = [
    { x: Math.round(topX + dir * 2), y: 16, facing: (dir === 1 ? -1 : 1) as -1 | 1, revealAt: 0.88 },
    { x: Math.round(clamp(baseX - dir * 24, 18, 78)), y: 41, facing: dir, revealAt: 0.72 },
    { x: Math.round(clamp(topX + dir * 20, 18, 78)), y: 31, facing: (dir === 1 ? -1 : 1) as -1 | 1, revealAt: 0.78 },
  ];

  return {
    species: 'sakura',
    seed: rng.intRange(1, 0x7fffffff),
    baseX,
    soilY,
    potBottomY,
    potStyle: 'terracotta',
    potBounds: { xMin: 37, xMax: 59, yMin: 91, yMax: 105 },
    sprout: { curveDir: dir, maxHeight: 13, leafSpread: 4 },
    trunkSegments,
    branches,
    rootFlares,
    foliageClusters,
    accents,
    perches,
    canopyBounds: computeCanopyBounds(foliageClusters, baseX, 40),
  };
}

function buildPineSkeleton(rng: Prng): TreeSkeleton {
  const baseX = 48;
  const soilY = 92;
  const potBottomY = 105;
  const tilt = rng.range(-1.2, 1.2);

  const trunkSegments: BranchSegment[] = [];
  const branches: BranchSegment[] = [];
  const rootFlares: RootFlare[] = [
    { x0: baseX - 1, y0: soilY - 3, x1: baseX - 5, y1: soilY + 1, r0: 1.6, r1: 0.8, revealAt: 0.62 },
    { x0: baseX + 1, y0: soilY - 3, x1: baseX + 5, y1: soilY + 1, r0: 1.6, r1: 0.8, revealAt: 0.65 },
  ];

  const cxAt = (y: number): number => baseX + tilt * ((92 - y) / 70);

  // Synced tapering evergreen trunk: each segment finishes right as its green bough tier crowns it
  trunkSegments.push(
    { x0: baseX, y0: soilY, x1: cxAt(80), y1: 80, r0: 2.9, r1: 2.5, revealAt: 0.12, growSpan: 0.04, swayLayer: 0, isTrunk: true },
    { x0: cxAt(80), y0: 80, x1: cxAt(72), y1: 72, r0: 2.5, r1: 2.2, revealAt: 0.16, growSpan: 0.04, swayLayer: 0, isTrunk: true },
    { x0: cxAt(72), y0: 72, x1: cxAt(58), y1: 58, r0: 2.2, r1: 1.8, revealAt: 0.24, growSpan: 0.06, swayLayer: 1, isTrunk: true },
    { x0: cxAt(58), y0: 58, x1: cxAt(45), y1: 45, r0: 1.8, r1: 1.4, revealAt: 0.38, growSpan: 0.06, swayLayer: 1, isTrunk: true },
    { x0: cxAt(45), y0: 45, x1: cxAt(32), y1: 32, r0: 1.4, r1: 1.1, revealAt: 0.56, growSpan: 0.06, swayLayer: 2, isTrunk: true },
    { x0: cxAt(32), y0: 32, x1: cxAt(21), y1: 21, r0: 1.1, r1: 0.85, revealAt: 0.78, growSpan: 0.08, swayLayer: 2, isTrunk: true }
  );

  // Subtle bough arm supports inside tiers (strictly after trunk segment finishes)
  const tierDefs: ReadonlyArray<{ ty: number; span: number; rev: number }> = [
    { ty: 72, span: 19, rev: 0.26 },
    { ty: 58, span: 15, rev: 0.32 },
    { ty: 45, span: 11, rev: 0.45 },
    { ty: 32, span: 7, rev: 0.63 },
  ];
  tierDefs.forEach(({ ty, span, rev }, idx) => {
    const cx = cxAt(ty);
    branches.push(
      { x0: cx, y0: ty - 1, x1: cx - span, y1: ty + 3, r0: 1.1, r1: 0.6, revealAt: rev, growSpan: 0.07, swayLayer: idx >= 2 ? 2 : 1 },
      { x0: cx, y0: ty - 1, x1: cx + span, y1: ty + 3, r0: 1.1, r1: 0.6, revealAt: rev + 0.02, growSpan: 0.07, swayLayer: idx >= 2 ? 2 : 1 }
    );
  });

  let cid = 1;
  const rawClusters: FoliageCluster[] = [
    // Sapling lower conifer tuft (sits at Seg 0 top, sheds cleanly as Tier 1 widens)
    { id: cid++, x: cxAt(82), y: 81, rx: 4.5, ry: 3.5, shape: 'pineBough', revealAt: 0.12, growSpan: 0.06, shedAt: 0.26, swayLayer: 1, depth: 1, toneBias: 0.0 },
    { id: cid++, x: cxAt(72), y: 72, rx: 6.5, ry: 4.5, shape: 'pineBough', revealAt: 0.20, growSpan: 0.08, swayLayer: 1, depth: 2, toneBias: 0.06 },

    // Tier 1 (wide lower skirt)
    { id: cid++, x: cxAt(72) - 9, y: 73, rx: 10.5, ry: 5.5, shape: 'pineBough', revealAt: 0.26, growSpan: 0.08, swayLayer: 1, depth: 1, toneBias: -0.08 },
    { id: cid++, x: cxAt(72) + 9, y: 73, rx: 10.5, ry: 5.5, shape: 'pineBough', revealAt: 0.28, growSpan: 0.08, swayLayer: 1, depth: 1, toneBias: 0.04 },
    { id: cid++, x: cxAt(70), y: 70, rx: 12, ry: 5.5, shape: 'pineBough', revealAt: 0.32, growSpan: 0.08, swayLayer: 1, depth: 2, toneBias: 0.08 },

    // Tier 2 (crowns Seg 1 top at y=58 cleanly!)
    { id: cid++, x: cxAt(58), y: 58, rx: 9.5, ry: 5.2, shape: 'pineBough', revealAt: 0.29, growSpan: 0.08, swayLayer: 1, depth: 3, toneBias: 0.1 },
    { id: cid++, x: cxAt(59) - 8, y: 60, rx: 9.5, ry: 5, shape: 'pineBough', revealAt: 0.35, growSpan: 0.08, swayLayer: 1, depth: 2, toneBias: -0.05 },
    { id: cid++, x: cxAt(59) + 8, y: 60, rx: 9.5, ry: 5, shape: 'pineBough', revealAt: 0.38, growSpan: 0.08, swayLayer: 1, depth: 2, toneBias: 0.06 },

    // Tier 3 (crowns Seg 2 top at y=45 before p=0.47!)
    { id: cid++, x: cxAt(45), y: 45, rx: 8.5, ry: 5, shape: 'pineBough', revealAt: 0.43, growSpan: 0.08, swayLayer: 2, depth: 4, toneBias: 0.14 },
    { id: cid++, x: cxAt(46) - 6, y: 47, rx: 8, ry: 4.5, shape: 'pineBough', revealAt: 0.47, growSpan: 0.08, swayLayer: 2, depth: 3, toneBias: -0.02 },
    { id: cid++, x: cxAt(46) + 6, y: 47, rx: 8, ry: 4.5, shape: 'pineBough', revealAt: 0.52, growSpan: 0.08, swayLayer: 2, depth: 3, toneBias: 0.08 },

    // Tier 4 (crowns Seg 3 top at y=32)
    { id: cid++, x: cxAt(32), y: 32, rx: 7, ry: 4.5, shape: 'pineBough', revealAt: 0.61, growSpan: 0.08, swayLayer: 2, depth: 5, toneBias: 0.18 },
    { id: cid++, x: cxAt(33) - 4, y: 34, rx: 6.5, ry: 4.5, shape: 'pineBough', revealAt: 0.65, growSpan: 0.08, swayLayer: 2, depth: 4, toneBias: 0.05 },
    { id: cid++, x: cxAt(33) + 4, y: 34, rx: 6.5, ry: 4.5, shape: 'pineBough', revealAt: 0.68, growSpan: 0.08, swayLayer: 2, depth: 4, toneBias: 0.12 },

    // Tier 5 (crowns Seg 4 top right as it extends at 0.78 — never a bare flagpole at 0.76!)
    { id: cid++, x: cxAt(22), y: 23, rx: 5.8, ry: 5.5, shape: 'pineBough', revealAt: 0.77, growSpan: 0.08, swayLayer: 2, depth: 6, toneBias: 0.2 },

    // Ancient outer bough tips & spire crown
    { id: cid++, x: cxAt(74) - 18, y: 74, rx: 6.5, ry: 4, shape: 'pineBough', revealAt: 0.90, growSpan: 0.05, swayLayer: 1, depth: 2, toneBias: 0.05 },
    { id: cid++, x: cxAt(74) + 18, y: 74, rx: 6.5, ry: 4, shape: 'pineBough', revealAt: 0.92, growSpan: 0.05, swayLayer: 1, depth: 2, toneBias: 0.1 },
    { id: cid++, x: cxAt(17), y: 18, rx: 4, ry: 4, shape: 'pineBough', revealAt: 0.94, growSpan: 0.05, swayLayer: 2, depth: 7, toneBias: 0.25 },
  ];

  const foliageClusters = rawClusters.map(clampCluster).sort((a, b) => a.depth - b.depth);

  // Crisp snow-dusted tips + warm pinecones
  let aid = 1;
  const accents: TreeAccent[] = [];
  const snowSpots: ReadonlyArray<readonly [number, number, number]> = [
    [cxAt(17), 16, 0.95],
    [cxAt(21) - 2, 20, 0.86],
    [cxAt(21) + 2, 21, 0.91],
    [cxAt(31) - 5, 31, 0.78],
    [cxAt(31) + 5, 31, 0.92],
    [cxAt(44) - 8, 44, 0.74],
    [cxAt(44) + 8, 44, 0.93],
    [cxAt(57) - 11, 56, 0.82],
    [cxAt(57) + 11, 56, 0.94],
    [cxAt(72) - 16, 70, 0.95],
    [cxAt(72) + 16, 70, 0.96],
  ];
  snowSpots.forEach(([sx, sy, rev], idx) => {
    accents.push({
      id: aid++,
      kind: 'snow',
      x: Math.round(sx),
      y: Math.round(sy),
      size: idx < 3 ? 2 : 3,
      revealAt: rev,
      swayLayer: sy < 50 ? 2 : 1,
      colorIndex: idx % 3,
    });
  });

  // Warm pinecones hanging beneath lower boughs
  const coneSpots: ReadonlyArray<readonly [number, number, number]> = [
    [cxAt(72) - 12, 77, 0.76],
    [cxAt(72) + 11, 77, 0.84],
    [cxAt(59) - 9, 64, 0.91],
    [cxAt(59) + 9, 64, 0.95],
  ];
  coneSpots.forEach(([px, py, rev], idx) => {
    accents.push({
      id: aid++,
      kind: 'pinecone',
      x: Math.round(px),
      y: Math.round(py),
      size: 2,
      revealAt: rev,
      swayLayer: 1,
      colorIndex: idx % 2,
    });
  });

  const perches: PerchPoint[] = [
    { x: Math.round(cxAt(17)), y: 15, facing: -1, revealAt: 0.88 },
    { x: Math.round(cxAt(46) + 12), y: 44, facing: -1, revealAt: 0.72 },
    { x: Math.round(cxAt(59) - 15), y: 56, facing: 1, revealAt: 0.70 },
  ];

  return {
    species: 'pine',
    seed: rng.intRange(1, 0x7fffffff),
    baseX,
    soilY,
    potBottomY,
    potStyle: 'stoneMound',
    potBounds: { xMin: 31, xMax: 65, yMin: 91, yMax: 105 },
    sprout: { curveDir: rng.chance(0.5) ? -1 : 1, maxHeight: 13, leafSpread: 3 },
    trunkSegments,
    branches,
    rootFlares,
    foliageClusters,
    accents,
    perches,
    canopyBounds: computeCanopyBounds(foliageClusters, baseX, 46),
  };
}

function buildMapleSkeleton(rng: Prng): TreeSkeleton {
  const baseX = 48;
  const soilY = 92;
  const potBottomY = 105;
  const sway = rng.range(-2.2, 2.2);

  const trunkSegments: BranchSegment[] = [];
  const branches: BranchSegment[] = [];
  const rootFlares: RootFlare[] = [
    { x0: baseX - 1, y0: soilY - 3, x1: baseX - 6, y1: soilY + 1, r0: 1.7, r1: 0.85, revealAt: 0.62 },
    { x0: baseX + 1, y0: soilY - 3, x1: baseX + 6, y1: soilY + 1, r0: 1.7, r1: 0.85, revealAt: 0.65 },
  ];

  // Trunk splits low into a sweeping V-crown (Seg 0: 0.12..0.16, Seg 1: 0.16..0.21)
  const forkX = baseX + sway * 0.4;
  const forkY = 66;
  addSegmentedLimb(
    trunkSegments,
    [
      [baseX, soilY],
      [baseX + sway * 0.2, 79],
      [forkX, forkY],
    ],
    3.2,
    2.1,
    0.12,
    0.21,
    0,
    1,
    true,
    0.05
  );

  // Main sweeping V-arms: Seg 0+1 grow early (0.22..0.36) so young clusters attach cleanly;
  // outermost tips extend alongside full crown (0.49..0.58)
  branches.push(
    { x0: forkX - 1, y0: forkY, x1: forkX - 10, y1: 52, r0: 1.9, r1: 1.5, revealAt: 0.22, growSpan: 0.06, swayLayer: 1 },
    { x0: forkX - 10, y0: 52, x1: forkX - 20, y1: 38, r0: 1.5, r1: 1.1, revealAt: 0.28, growSpan: 0.08, swayLayer: 2 },
    { x0: forkX - 20, y0: 38, x1: forkX - 27, y1: 29, r0: 1.1, r1: 0.75, revealAt: 0.49, growSpan: 0.08, swayLayer: 2 },

    { x0: forkX + 1, y0: forkY, x1: forkX + 10, y1: 52, r0: 1.9, r1: 1.5, revealAt: 0.23, growSpan: 0.06, swayLayer: 1 },
    { x0: forkX + 10, y0: 52, x1: forkX + 20, y1: 37, r0: 1.5, r1: 1.1, revealAt: 0.29, growSpan: 0.08, swayLayer: 2 },
    { x0: forkX + 20, y0: 37, x1: forkX + 27, y1: 28, r0: 1.1, r1: 0.75, revealAt: 0.50, growSpan: 0.08, swayLayer: 2 }
  );
  // Central V-fork reaches y=31 by 0.41 before center cluster at 0.42!
  addSegmentedLimb(
    branches,
    [
      [forkX, forkY],
      [forkX + sway * 0.5, 48],
      [forkX + sway, 31],
    ],
    1.6,
    0.75,
    0.26,
    0.40,
    1,
    2,
    false,
    0.07
  );
  // Secondary inward & outer maple forks (extend alongside upper crown clusters)
  addSegmentedLimb(
    branches,
    [
      [forkX - 10, 52],
      [forkX - 12, 36],
      [forkX - 14, 24],
    ],
    1.2,
    0.65,
    0.40,
    0.62,
    1,
    2,
    false,
    0.07
  );
  addSegmentedLimb(
    branches,
    [
      [forkX + 10, 52],
      [forkX + 12, 36],
      [forkX + 14, 24],
    ],
    1.2,
    0.65,
    0.41,
    0.63,
    1,
    2,
    false,
    0.07
  );

  let cid = 1;
  const rawClusters: FoliageCluster[] = [
    // Temporary sapling tufts (shed cleanly as young V-crown fills out, leaving bare trunk!)
    { id: cid++, x: baseX + sway * 0.15, y: 82, rx: 3.5, ry: 3, shape: 'puff', revealAt: 0.12, growSpan: 0.06, shedAt: 0.32, swayLayer: 1, depth: 2, toneBias: 0.02 },
    { id: cid++, x: forkX, y: 64, rx: 4, ry: 3, shape: 'puff', revealAt: 0.21, growSpan: 0.06, shedAt: 0.36, swayLayer: 1, depth: 2, toneBias: -0.05 },

    // Young sweeping V-fan (starts strictly after parent branch segments reach attachment!)
    { id: cid++, x: forkX - 11, y: 45, rx: 7.5, ry: 5, shape: 'puff', revealAt: 0.32, growSpan: 0.09, swayLayer: 1, depth: 2, toneBias: -0.15 },
    { id: cid++, x: forkX + 11, y: 44, rx: 7.5, ry: 5, shape: 'puff', revealAt: 0.36, growSpan: 0.09, swayLayer: 1, depth: 2, toneBias: -0.05 },
    { id: cid++, x: forkX, y: 34, rx: 9.5, ry: 6, shape: 'puff', revealAt: 0.42, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.08 },
    { id: cid++, x: forkX - 16, y: 34, rx: 8, ry: 5.5, shape: 'puff', revealAt: 0.47, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.04 },
    { id: cid++, x: forkX + 16, y: 33, rx: 8, ry: 5.5, shape: 'puff', revealAt: 0.52, growSpan: 0.09, swayLayer: 2, depth: 3, toneBias: 0.1 },

    // Full wide sweeping autumn crown
    { id: cid++, x: forkX - 23, y: 31, rx: 8, ry: 5.5, shape: 'puff', revealAt: 0.62, growSpan: 0.09, swayLayer: 2, depth: 2, toneBias: -0.05 },
    { id: cid++, x: forkX + 23, y: 30, rx: 8, ry: 5.5, shape: 'puff', revealAt: 0.66, growSpan: 0.09, swayLayer: 2, depth: 2, toneBias: 0.08 },
    { id: cid++, x: forkX - 12, y: 26, rx: 8.5, ry: 5.5, shape: 'puff', revealAt: 0.71, growSpan: 0.09, swayLayer: 2, depth: 4, toneBias: 0.18 },
    { id: cid++, x: forkX + 12, y: 25, rx: 8.5, ry: 5.5, shape: 'puff', revealAt: 0.75, growSpan: 0.09, swayLayer: 2, depth: 4, toneBias: 0.22 },
    { id: cid++, x: forkX, y: 24, rx: 9.5, ry: 5.5, shape: 'puff', revealAt: 0.80, growSpan: 0.08, swayLayer: 2, depth: 5, toneBias: 0.26 },
    { id: cid++, x: forkX - 19, y: 40, rx: 6.5, ry: 4.5, shape: 'puff', revealAt: 0.84, growSpan: 0.08, swayLayer: 2, depth: 1, toneBias: -0.2 },
    { id: cid++, x: forkX + 19, y: 39, rx: 6.5, ry: 4.5, shape: 'puff', revealAt: 0.86, growSpan: 0.08, swayLayer: 2, depth: 1, toneBias: -0.15 },

    // Ancient blazing maple tips seamlessly extending crown shoulders
    { id: cid++, x: forkX - 27, y: 28, rx: 5.5, ry: 4, shape: 'puff', revealAt: 0.90, growSpan: 0.05, swayLayer: 2, depth: 5, toneBias: 0.18 },
    { id: cid++, x: forkX + 27, y: 27, rx: 5.5, ry: 4, shape: 'puff', revealAt: 0.92, growSpan: 0.05, swayLayer: 2, depth: 5, toneBias: 0.24 },
    { id: cid++, x: forkX + rng.range(-3, 3), y: 19, rx: 7, ry: 4, shape: 'puff', revealAt: 0.94, growSpan: 0.05, swayLayer: 2, depth: 6, toneBias: 0.3 },
  ];

  const foliageClusters = rawClusters
    .map((c) =>
      clampCluster({
        ...c,
        x: c.x + rng.range(-1.2, 1.2),
        y: c.y + rng.range(-0.8, 0.8),
      })
    )
    .sort((a, b) => a.depth - b.depth);

  let aid = 1;
  const accents: TreeAccent[] = [];
  for (let i = 0; i < 10; i++) {
    const cluster = foliageClusters[(i * 2 + 5) % foliageClusters.length];
    accents.push({
      id: aid++,
      kind: 'mapleLeaf',
      x: clamp(Math.round(cluster.x + rng.range(-cluster.rx * 0.65, cluster.rx * 0.65)), 11, 85),
      y: clamp(Math.round(cluster.y + rng.range(-cluster.ry * 0.55, cluster.ry * 0.55)), 16, 52),
      size: i % 2 === 0 ? 2 : 1,
      revealAt: i < 3 ? 0.72 + i * 0.06 : 0.90 + ((i - 3) * 0.08) / 7,
      swayLayer: 2,
      colorIndex: i % 3,
    });
  }

  const perches: PerchPoint[] = [
    { x: Math.round(forkX + 25), y: 24, facing: -1, revealAt: 0.74 },
    { x: Math.round(forkX - 25), y: 25, facing: 1, revealAt: 0.76 },
    { x: Math.round(forkX), y: 16, facing: -1, revealAt: 0.88 },
  ];

  return {
    species: 'maple',
    seed: rng.intRange(1, 0x7fffffff),
    baseX,
    soilY,
    potBottomY,
    potStyle: 'slatePot',
    potBounds: { xMin: 37, xMax: 59, yMin: 91, yMax: 105 },
    sprout: { curveDir: rng.chance(0.5) ? -1 : 1, maxHeight: 14, leafSpread: 4 },
    trunkSegments,
    branches,
    rootFlares,
    foliageClusters,
    accents,
    perches,
    canopyBounds: computeCanopyBounds(foliageClusters, baseX, 38),
  };
}

function buildBonsaiSkeleton(rng: Prng): TreeSkeleton {
  const dir: -1 | 1 = rng.chance(0.5) ? 1 : -1;
  const baseX = 48 - dir * 6;
  const soilY = 93;
  const potBottomY = 105;

  const trunkSegments: BranchSegment[] = [];
  const branches: BranchSegment[] = [];

  // Exposed surface roots gripping the soil mound
  const rootFlares: RootFlare[] = [
    { x0: baseX - 1, y0: soilY - 3, x1: baseX - 6, y1: soilY + 1, r0: 1.8, r1: 0.85, revealAt: 0.56 },
    { x0: baseX + 1, y0: soilY - 3, x1: baseX + 6, y1: soilY + 1, r0: 1.8, r1: 0.85, revealAt: 0.60 },
    { x0: baseX + dir * 2, y0: soilY - 2, x1: baseX + dir * 8, y1: soilY + 1, r0: 1.4, r1: 0.7, revealAt: 0.66 },
  ];

  // Dramatic gnarled S-curved bonsai trunk (finishes segs at 0.16, 0.21, 0.28, 0.34, 0.41)
  const bend1X = baseX + dir * 13;
  const bend2X = baseX - dir * 4;
  const apexX = baseX + dir * 6;
  addSegmentedLimb(
    trunkSegments,
    [
      [baseX, soilY],
      [baseX + dir * 6, 84],
      [bend1X, 74],
      [baseX + dir * 5, 62],
      [bend2X, 51],
      [apexX, 39],
    ],
    3.4,
    1.3,
    0.12,
    0.40,
    0,
    1,
    true,
    0.05
  );

  // Horizontal sculpted bonsai limbs (every child starts strictly after parent trunk bend finishes!)
  const pad1X = bend1X + dir * 12;
  const pad2X = bend2X - dir * 16;
  const pad3X = apexX + dir * 11;
  const pad4X = apexX - dir * 2;

  addSegmentedLimb(
    branches,
    [
      [bend1X - dir * 1, 73],
      [pad1X - dir * 4, 71],
      [pad1X, 69],
    ],
    1.4,
    0.75,
    0.22,
    0.31,
    1,
    1,
    false,
    0.05
  );
  addSegmentedLimb(
    branches,
    [
      [bend2X + dir * 1, 52],
      [pad2X + dir * 5, 53],
      [pad2X, 54],
    ],
    1.3,
    0.7,
    0.34,
    0.44,
    1,
    2,
    false,
    0.05
  );
  addSegmentedLimb(
    branches,
    [
      [apexX, 42],
      [pad3X - dir * 3, 42],
      [pad3X, 41],
    ],
    1.1,
    0.65,
    0.44,
    0.54,
    1,
    2,
    false,
    0.05
  );
  addSegmentedLimb(
    branches,
    [
      [apexX, 39],
      [pad4X, 32],
    ],
    1.5,
    0.9,
    0.50,
    0.58,
    2,
    2,
    false,
    0.06
  );

  let cid = 1;
  const rawClusters: FoliageCluster[] = [
    // Temporary lower-trunk sapling tuft (sheds cleanly once Pad 1 blooms!)
    { id: cid++, x: baseX + dir * 4.2, y: 86, rx: 3.5, ry: 2.5, shape: 'cloudPad', revealAt: 0.12, growSpan: 0.06, shedAt: 0.32, swayLayer: 1, depth: 1, toneBias: 0.05 },
    // Early Pad 1 starter right on Branch 0 tip (merges inside Pad 1!)
    { id: cid++, x: pad1X - dir * 3, y: 70, rx: 4.5, ry: 2.5, shape: 'cloudPad', revealAt: 0.27, growSpan: 0.06, swayLayer: 1, depth: 2, toneBias: 0.1 },

    // Pad 1 (lower shelf)
    { id: cid++, x: pad1X, y: 67, rx: 9.5, ry: 4, shape: 'cloudPad', revealAt: 0.32, growSpan: 0.08, swayLayer: 1, depth: 3, toneBias: 0.02 },

    // Pad 2 (opposite mid shelf — after Branch 1 Seg 0 finishes at 0.39!)
    { id: cid++, x: pad2X + dir * 3, y: 53, rx: 6, ry: 3, shape: 'cloudPad', revealAt: 0.40, growSpan: 0.08, swayLayer: 2, depth: 2, toneBias: -0.05 },
    { id: cid++, x: pad2X - dir * 1, y: 52, rx: 10.5, ry: 4, shape: 'cloudPad', revealAt: 0.49, growSpan: 0.08, swayLayer: 2, depth: 4, toneBias: 0.08 },

    // Pad 3 (upper shelf — after Branch 2 finishes at 0.59)
    { id: cid++, x: pad3X, y: 40, rx: 8.5, ry: 3.5, shape: 'cloudPad', revealAt: 0.62, growSpan: 0.08, swayLayer: 2, depth: 4, toneBias: 0.12 },

    // Pad 4 (crown apex cloud — after Branch 3 finishes at 0.56)
    { id: cid++, x: pad4X, y: 31, rx: 10.5, ry: 4.5, shape: 'cloudPad', revealAt: 0.72, growSpan: 0.08, swayLayer: 2, depth: 5, toneBias: 0.2 },

    // Ancient secondary overlapping cloud layers for sculptural fullness
    { id: cid++, x: pad1X + dir * 3, y: 65, rx: 6.5, ry: 3, shape: 'cloudPad', revealAt: 0.90, growSpan: 0.05, swayLayer: 1, depth: 4, toneBias: 0.16 },
    { id: cid++, x: pad2X - dir * 3, y: 50, rx: 7, ry: 3, shape: 'cloudPad', revealAt: 0.92, growSpan: 0.05, swayLayer: 2, depth: 5, toneBias: 0.18 },
    { id: cid++, x: pad4X, y: 27, rx: 7.5, ry: 3.5, shape: 'cloudPad', revealAt: 0.94, growSpan: 0.05, swayLayer: 2, depth: 6, toneBias: 0.25 },
  ];

  const foliageClusters = rawClusters
    .map((c) =>
      clampCluster({
        ...c,
        x: c.x + rng.range(-0.8, 0.8),
        y: c.y + rng.range(-0.5, 0.5),
      })
    )
    .sort((a, b) => a.depth - b.depth);

  // Tiny delicate pink/white blooms resting atop cloud pads
  let aid = 1;
  const padAnchors = [
    foliageClusters[2],
    foliageClusters[4],
    foliageClusters[5],
    foliageClusters[6],
    foliageClusters[foliageClusters.length - 1],
  ];
  const accents: TreeAccent[] = [];
  for (let i = 0; i < 8; i++) {
    const pad = padAnchors[i % padAnchors.length];
    accents.push({
      id: aid++,
      kind: 'bonsaiBloom',
      x: clamp(Math.round(pad.x + rng.range(-pad.rx * 0.55, pad.rx * 0.55)), 16, 80),
      y: clamp(Math.round(pad.y - pad.ry * 0.45), 22, 70),
      size: 1,
      revealAt: i < 2 ? 0.78 + i * 0.06 : 0.90 + ((i - 2) * 0.08) / 6,
      swayLayer: pad.swayLayer,
      colorIndex: i % 2,
    });
  }

  const zenStone = {
    x: clamp(48 + dir * 13, 30, 66),
    y: 94,
    rx: 4,
    ry: 2.5,
  };

  const perches: PerchPoint[] = [
    { x: Math.round(clamp(pad4X, 24, 72)), y: 24, facing: (dir === 1 ? -1 : 1) as -1 | 1, revealAt: 0.88 },
    { x: Math.round(clamp(pad2X, 20, 76)), y: 48, facing: dir, revealAt: 0.72 },
    { x: Math.round(clamp(pad1X, 20, 76)), y: 63, facing: (dir === 1 ? -1 : 1) as -1 | 1, revealAt: 0.68 },
  ];

  return {
    species: 'bonsai',
    seed: rng.intRange(1, 0x7fffffff),
    baseX,
    soilY,
    potBottomY,
    potStyle: 'ceramicTray',
    potBounds: { xMin: 24, xMax: 72, yMin: 95, yMax: 105 },
    zenStone,
    sprout: { curveDir: dir, maxHeight: 12, leafSpread: 3 },
    trunkSegments,
    branches,
    rootFlares,
    foliageClusters,
    accents,
    perches,
    canopyBounds: computeCanopyBounds(foliageClusters, 48, 52),
  };
}

/**
 * Generates a deterministic procedural tree skeleton for the given species and seed.
 */
export function generateTreeSkeleton(species: SpeciesId, seed: number): TreeSkeleton {
  const rng = createPrng(seed);
  let skeleton: TreeSkeleton;

  switch (species) {
    case 'oak':
      skeleton = buildOakSkeleton(rng);
      break;
    case 'sakura':
      skeleton = buildSakuraSkeleton(rng);
      break;
    case 'pine':
      skeleton = buildPineSkeleton(rng);
      break;
    case 'maple':
      skeleton = buildMapleSkeleton(rng);
      break;
    case 'bonsai':
      skeleton = buildBonsaiSkeleton(rng);
      break;
    default: {
      const exhaustive: never = species;
      throw new Error(`Unsupported species: ${exhaustive}`);
    }
  }

  return { ...skeleton, seed };
}
