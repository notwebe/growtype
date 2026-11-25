import {
  SPECIES_META,
  TreeRecord,
  renderStaticTreeToCanvas,
} from '../engine';

function nextStarRand(state: { seed: number }): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface MeadowRendererOptions {
  viewportEl: HTMLElement;
  inspectorEl: HTMLElement;
  countBadgeEl: HTMLElement;
}

export interface MeadowRenderer {
  update(forest: TreeRecord[]): void;
  destroy(): void;
}

function formatHarvestDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildTwilightBackdrop(): DocumentFragment {
  const frag = document.createDocumentFragment();

  const sky = document.createElement('div');
  sky.className = 'meadow-sky';
  sky.setAttribute('aria-hidden', 'true');

  const moon = document.createElement('div');
  moon.className = 'meadow-moon';
  sky.appendChild(moon);

  const starRng = { seed: 90421 };
  for (let i = 0; i < 42; i++) {
    const star = document.createElement('span');
    const r1 = nextStarRand(starRng);
    const r2 = nextStarRand(starRng);
    const r3 = nextStarRand(starRng);
    const r4 = nextStarRand(starRng);
    star.className = r1 < 0.28 ? 'meadow-star is-warm' : 'meadow-star';
    star.style.left = `${(2 + r2 * 96).toFixed(2)}%`;
    star.style.top = `${(6 + r3 * 72).toFixed(2)}%`;
    star.style.opacity = (0.25 + r4 * 0.6).toFixed(2);
    sky.appendChild(star);
  }

  const hill = document.createElement('div');
  hill.className = 'meadow-hill';
  hill.setAttribute('aria-hidden', 'true');

  frag.appendChild(sky);
  frag.appendChild(hill);
  return frag;
}

function buildEmptyIllustration(): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 36');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', '48');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');

  const rects: Array<[number, number, number, number, string]> = [
    [16, 28, 16, 5, '#8c533c'],
    [14, 26, 20, 3, '#b56d4f'],
    [17, 25, 14, 2, '#4f382d'],
    [23, 18, 2, 7, '#52b788'],
    [19, 15, 4, 3, '#74c69d'],
    [25, 16, 4, 3, '#52b788'],
    [10, 8, 1, 1, '#ffe3a8'],
    [36, 6, 1, 1, '#d7e7ff'],
    [31, 12, 1, 1, '#ffe3a8'],
  ];

  for (const [x, y, w, h, fill] of rects) {
    const r = document.createElementNS(svgNS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', fill);
    svg.appendChild(r);
  }

  return svg;
}

export function createMeadowRenderer(options: MeadowRendererOptions): MeadowRenderer {
  const { viewportEl, inspectorEl, countBadgeEl } = options;

  let currentForest: TreeRecord[] = [];
  let lastSignature = '';
  let selectedTreeId: string | null = null;
  let hoveredTreeId: string | null = null;
  const slotElements = new Map<string, HTMLButtonElement>();

  const renderInspector = (): void => {
    inspectorEl.replaceChildren();

    if (currentForest.length === 0) {
      inspectorEl.textContent = 'Grow your first tree to 100% to plant it here';
      return;
    }

    const activeId = hoveredTreeId ?? selectedTreeId;
    const index = activeId ? currentForest.findIndex((t) => t.id === activeId) : -1;
    if (index === -1) {
      inspectorEl.textContent = 'Hover or click a tree to inspect';
      return;
    }

    const tree = currentForest[index];
    const meta = SPECIES_META[tree.species];

    const dot = document.createElement('span');
    dot.className = 'inspector-dot';
    dot.style.backgroundColor = meta.accentHex;

    const title = document.createElement('strong');
    title.textContent = `${meta.name} #${index + 1}`;

    const sep1 = document.createElement('span');
    sep1.className = 'inspector-sep';
    sep1.textContent = '·';

    const dateSpan = document.createElement('span');
    dateSpan.textContent = `Harvested ${formatHarvestDate(tree.harvestedAt ?? tree.createdAt)}`;

    const sep2 = document.createElement('span');
    sep2.className = 'inspector-sep';
    sep2.textContent = '·';

    const keysSpan = document.createElement('strong');
    keysSpan.textContent = `${tree.keystrokes.toLocaleString()} keys`;

    inspectorEl.append(dot, title, sep1, dateSpan, sep2, keysSpan);
  };

  const syncSelectionClasses = (): void => {
    for (const [id, slot] of slotElements) {
      slot.classList.toggle('is-selected', id === selectedTreeId);
    }
  };

  return {
    update(forest: TreeRecord[]): void {
      const signature = forest
        .map((t) => `${t.id}:${t.species}:${t.seed}:${t.keystrokes}:${t.harvestedAt ?? ''}`)
        .join('|');

      countBadgeEl.textContent = `${forest.length} ${forest.length === 1 ? 'tree' : 'trees'}`;

      if (signature === lastSignature) {
        return;
      }

      const previousCount = currentForest.length;
      const previousScrollLeft = viewportEl.scrollLeft;
      lastSignature = signature;
      currentForest = forest;
      slotElements.clear();
      viewportEl.replaceChildren();

      if (forest.length === 0) {
        selectedTreeId = null;
        hoveredTreeId = null;

        const stage = document.createElement('div');
        stage.className = 'meadow-stage';
        stage.appendChild(buildTwilightBackdrop());

        const empty = document.createElement('div');
        empty.className = 'meadow-empty';
        empty.appendChild(buildEmptyIllustration());

        const copy = document.createElement('div');
        copy.className = 'meadow-empty-copy';

        const heading = document.createElement('h3');
        heading.textContent = 'Your twilight meadow awaits its first tree';

        const sub = document.createElement('p');
        sub.textContent =
          'Every keystroke nurtures your desk tree. Reach 100% and harvest it to grow a lasting pixel forest here.';

        copy.append(heading, sub);
        empty.appendChild(copy);
        stage.appendChild(empty);
        viewportEl.appendChild(stage);
        renderInspector();
        return;
      }

      if (!selectedTreeId || !forest.some((t) => t.id === selectedTreeId)) {
        selectedTreeId = forest[forest.length - 1].id;
      } else if (forest.length > previousCount) {
        selectedTreeId = forest[forest.length - 1].id;
      }

      const stage = document.createElement('div');
      stage.className = 'meadow-stage';
      stage.appendChild(buildTwilightBackdrop());

      const treesRow = document.createElement('div');
      treesRow.className = 'meadow-trees-row';

      forest.forEach((tree, index) => {
        const meta = SPECIES_META[tree.species];
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'meadow-tree-slot';
        slot.setAttribute(
          'aria-label',
          `${meta.name} #${index + 1}, harvested ${formatHarvestDate(tree.harvestedAt ?? tree.createdAt)}, ${tree.keystrokes.toLocaleString()} keystrokes`,
        );

        const canvas = document.createElement('canvas');
        canvas.className = 'meadow-tree-canvas';
        renderStaticTreeToCanvas(canvas, tree.species, tree.seed, 1, 2);

        const tag = document.createElement('span');
        tag.className = 'meadow-tree-tag';
        tag.textContent = `#${index + 1}`;

        slot.append(canvas, tag);

        slot.addEventListener('pointerenter', () => {
          hoveredTreeId = tree.id;
          renderInspector();
        });
        slot.addEventListener('pointerleave', () => {
          if (hoveredTreeId === tree.id) {
            hoveredTreeId = null;
            renderInspector();
          }
        });
        slot.addEventListener('focus', () => {
          hoveredTreeId = tree.id;
          renderInspector();
        });
        slot.addEventListener('blur', () => {
          if (hoveredTreeId === tree.id) {
            hoveredTreeId = null;
            renderInspector();
          }
        });
        slot.addEventListener('click', () => {
          selectedTreeId = tree.id;
          syncSelectionClasses();
          renderInspector();
        });

        slotElements.set(tree.id, slot);
        treesRow.appendChild(slot);
      });

      stage.appendChild(treesRow);
      viewportEl.appendChild(stage);
      syncSelectionClasses();
      renderInspector();

      if (forest.length > previousCount) {
        viewportEl.scrollLeft = viewportEl.scrollWidth;
      } else {
        viewportEl.scrollLeft = previousScrollLeft;
      }
    },

    destroy(): void {
      slotElements.clear();
      viewportEl.replaceChildren();
    },
  };
}
