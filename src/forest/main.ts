import {
  GrowthStage,
  SPECIES_META,
  SPECIES_ORDER,
  STAGE_LABELS,
  STAGE_ORDER,
  SpeciesId,
  TreeScene,
  getGrowthProgress,
  getGrowthStage,
  renderStaticTreeToCanvas,
} from '../engine';
import { AppState, GrowthPace, SaveProgressInfo, WidgetScale } from '../shared/types';
import { getGrowTypeAPI } from '../widget/browserFallback';
import { createMeadowRenderer } from './meadowRenderer';

const SPECIES_PREVIEW_SEEDS: Record<SpeciesId, number> = {
  oak: 104729,
  sakura: 224737,
  pine: 350377,
  maple: 479909,
  bonsai: 611953,
};

function mustElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required forest element #${id}`);
  }
  return el as T;
}

function getNextSpecies(current: SpeciesId): SpeciesId {
  const idx = SPECIES_ORDER.indexOf(current);
  if (idx === -1) return SPECIES_ORDER[0];
  return SPECIES_ORDER[(idx + 1) % SPECIES_ORDER.length];
}

function main(): void {
  const api = getGrowTypeAPI();

  // Header status badges
  const headerPausedBadge = mustElement<HTMLSpanElement>('header-paused-badge');
  const headerGhostBadge = mustElement<HTMLSpanElement>('header-ghost-badge');
  const headerSpeciesBadge = mustElement<HTMLSpanElement>('header-species-badge');

  // Hero card elements
  const heroCardEl = document.querySelector('.hero-card') as HTMLElement;
  const heroCanvas = mustElement<HTMLCanvasElement>('hero-tree-canvas');
  const heroStageBadge = mustElement<HTMLSpanElement>('hero-stage-badge');
  const heroSpeciesDot = mustElement<HTMLSpanElement>('hero-species-dot');
  const heroSpeciesName = mustElement<HTMLHeadingElement>('hero-species-name');
  const heroSpeciesSubtitle = mustElement<HTMLParagraphElement>('hero-species-subtitle');
  const heroProgressCount = mustElement<HTMLSpanElement>('hero-progress-count');
  const heroProgressPct = mustElement<HTMLSpanElement>('hero-progress-pct');
  const heroProgressFill = mustElement<HTMLDivElement>('hero-progress-fill');
  const testKeysBtn = mustElement<HTMLButtonElement>('test-keys-btn');
  const harvestTreeBtn = mustElement<HTMLButtonElement>('harvest-tree-btn');
  const statToday = mustElement<HTMLElement>('stat-today');
  const statLifetime = mustElement<HTMLElement>('stat-lifetime');
  const statTrees = mustElement<HTMLElement>('stat-trees');

  // Settings elements
  const settingsFeedback = mustElement<HTMLSpanElement>('settings-feedback');
  const paceControl = mustElement<HTMLDivElement>('pace-control');
  const scaleControl = mustElement<HTMLDivElement>('scale-control');
  const toggleAlwaysOnTop = mustElement<HTMLInputElement>('toggle-always-on-top');
  const toggleClickThrough = mustElement<HTMLInputElement>('toggle-click-through');
  const togglePaused = mustElement<HTMLInputElement>('toggle-paused');
  const toggleLaunchLogin = mustElement<HTMLInputElement>('toggle-launch-login');
  const saveStatusText = mustElement<HTMLSpanElement>('save-status-text');
  const saveNowBtn = mustElement<HTMLButtonElement>('save-now-btn');
  const openSaveFolderBtn = mustElement<HTMLButtonElement>('open-save-folder-btn');
  const resetPositionBtn = mustElement<HTMLButtonElement>('reset-position-btn');

  // Meadow elements
  const meadowViewport = mustElement<HTMLDivElement>('meadow-viewport');
  const meadowInspector = mustElement<HTMLDivElement>('meadow-inspector');
  const meadowCountBadge = mustElement<HTMLSpanElement>('meadow-count-badge');

  // Species picker elements
  const speciesConfirmBar = mustElement<HTMLDivElement>('species-confirm-bar');
  const speciesConfirmText = mustElement<HTMLParagraphElement>('species-confirm-text');
  const speciesConfirmYes = mustElement<HTMLButtonElement>('species-confirm-yes');
  const speciesConfirmNo = mustElement<HTMLButtonElement>('species-confirm-no');
  const speciesGrid = mustElement<HTMLDivElement>('species-grid');

  const heroScene = new TreeScene(heroCanvas, {
    scale: 2,
    ambientLife: true,
    background: 'sky',
  });

  const meadow = createMeadowRenderer({
    viewportEl: meadowViewport,
    inspectorEl: meadowInspector,
    countBadgeEl: meadowCountBadge,
  });

  let currentState: AppState | null = null;
  let pendingSpeciesSwitch: SpeciesId | null = null;
  let feedbackTimer: number | null = null;
  let saveRefreshTimer: number | null = null;
  let lastHeroTreeId: string | null = null;
  let lastHeroStage: GrowthStage = 'seed';
  let lastHeroTreeSignature = '';

  const renderSaveInfo = (info: SaveProgressInfo): void => {
    saveStatusText.title = info.filePath;
    if (!info.lastSavedAt) {
      saveStatusText.textContent = 'Auto-save active';
      return;
    }
    const parsed = new Date(info.lastSavedAt);
    if (Number.isNaN(parsed.getTime())) {
      saveStatusText.textContent = 'Auto-saved';
      return;
    }
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    saveStatusText.textContent = `Auto-saved · ${hh}:${mm}:${ss}`;
  };

  const refreshSaveInfoSoon = (): void => {
    if (saveRefreshTimer !== null) return;
    saveRefreshTimer = window.setTimeout(() => {
      saveRefreshTimer = null;
      void api.getSaveInfo().then(renderSaveInfo);
    }, 1000);
  };

  const syncHeroTree = (tree: AppState['activeTree']): void => {
    const sig = `${tree.id}:${tree.species}:${tree.seed}:${tree.keystrokes}:${tree.targetKeystrokes}`;
    if (sig === lastHeroTreeSignature) return;
    lastHeroTreeSignature = sig;
    heroScene.setTree(tree);
  };

  const showFeedback = (message: string): void => {
    settingsFeedback.textContent = message;
    if (feedbackTimer !== null) {
      window.clearTimeout(feedbackTimer);
    }
    feedbackTimer = window.setTimeout(() => {
      feedbackTimer = null;
      settingsFeedback.textContent = '';
    }, 2000);
  };

  const hideSpeciesConfirm = (): void => {
    pendingSpeciesSwitch = null;
    speciesConfirmBar.hidden = true;
  };

  const showSpeciesConfirm = (targetSpecies: SpeciesId, state: AppState): void => {
    pendingSpeciesSwitch = targetSpecies;
    const currentMeta = SPECIES_META[state.activeTree.species];
    const targetMeta = SPECIES_META[targetSpecies];
    const progressText = `${state.activeTree.keystrokes.toLocaleString()} / ${state.activeTree.targetKeystrokes.toLocaleString()} keys`;
    speciesConfirmText.textContent =
      state.activeTree.keystrokes > 0
        ? `Switch from ${currentMeta.name} (${progressText}) to ${targetMeta.name}? Progress on your active tree will be reset.`
        : `Plant a new ${targetMeta.name} instead of ${currentMeta.name}?`;
    speciesConfirmYes.textContent = `Plant ${targetMeta.name}`;
    speciesConfirmBar.hidden = false;
  };

  // Build Species Picker Grid
  const speciesTiles = new Map<SpeciesId, { button: HTMLButtonElement; badge: HTMLSpanElement }>();

  for (const species of SPECIES_ORDER) {
    const meta = SPECIES_META[species];
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'species-tile';
    tile.setAttribute('role', 'listitem');
    tile.style.setProperty('--tile-accent', meta.accentHex);

    const activeTag = document.createElement('span');
    activeTag.className = 'species-active-tag';
    activeTag.textContent = 'Active';
    activeTag.hidden = true;

    const previewWrap = document.createElement('div');
    previewWrap.className = 'species-preview-wrap';

    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'species-preview-canvas';
    renderStaticTreeToCanvas(previewCanvas, species, SPECIES_PREVIEW_SEEDS[species], 1, 2);
    // Fit cleanly 1:1 in 5-column desktop grid while preserving crisp pixelated rendering.
    previewCanvas.style.width = '96px';
    previewCanvas.style.height = '112px';
    previewWrap.appendChild(previewCanvas);

    const metaBox = document.createElement('div');
    metaBox.className = 'species-tile-meta';

    const titleRow = document.createElement('div');
    titleRow.className = 'species-tile-title';

    const dot = document.createElement('span');
    dot.className = 'species-dot';
    dot.style.backgroundColor = meta.accentHex;

    const name = document.createElement('span');
    name.textContent = meta.name;

    titleRow.append(dot, name);

    const subtitle = document.createElement('span');
    subtitle.className = 'species-tile-subtitle';
    subtitle.textContent = meta.subtitle;

    metaBox.append(titleRow, subtitle);
    tile.append(activeTag, previewWrap, metaBox);

    tile.addEventListener('click', async () => {
      if (!currentState) return;
      if (species === currentState.activeTree.species) {
        hideSpeciesConfirm();
        return;
      }

      const mature = getGrowthProgress(currentState.activeTree) >= 1;
      if (mature) {
        hideSpeciesConfirm();
        heroScene.triggerStageUp('ancient');
        const nextState = await api.harvestAndPlant(species);
        applyState(nextState);
        showFeedback(`Harvested & planted ${meta.name}!`);
      } else {
        showSpeciesConfirm(species, currentState);
      }
    });

    speciesTiles.set(species, { button: tile, badge: activeTag });
    speciesGrid.appendChild(tile);
  }

  const updateHeroAndStats = (
    species: SpeciesId,
    treeId: string,
    keystrokes: number,
    targetKeystrokes: number,
    todayKeystrokes: number,
    totalKeystrokes: number,
    forestCount: number,
  ): void => {
    const meta = SPECIES_META[species];
    const progress = getGrowthProgress({ keystrokes, targetKeystrokes });
    const stage = getGrowthStage(progress);
    const isMature = progress >= 1;

    if (lastHeroTreeId !== treeId) {
      lastHeroTreeId = treeId;
      lastHeroStage = stage;
    } else if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(lastHeroStage)) {
      lastHeroStage = stage;
      heroScene.triggerStageUp(stage);
    }

    heroCardEl.style.setProperty('--species-accent', meta.accentHex);
    heroCardEl.classList.toggle('is-mature', isMature);

    heroSpeciesDot.style.backgroundColor = meta.accentHex;
    heroSpeciesName.textContent = meta.name;
    heroSpeciesSubtitle.textContent = meta.subtitle;

    heroStageBadge.textContent = isMature ? 'Ready to Harvest!' : STAGE_LABELS[stage];
    heroStageBadge.classList.toggle('is-mature', isMature);
    heroStageBadge.style.borderColor = isMature ? '' : meta.accentHex;

    heroProgressCount.textContent = `${keystrokes.toLocaleString()} / ${targetKeystrokes.toLocaleString()} keys`;
    heroProgressPct.textContent = `${Math.floor(progress * 100)}%`;
    heroProgressFill.style.width = `${(progress * 100).toFixed(2)}%`;

    harvestTreeBtn.disabled = !isMature;
    harvestTreeBtn.classList.toggle('is-ready', isMature);

    statToday.textContent = todayKeystrokes.toLocaleString();
    statLifetime.textContent = totalKeystrokes.toLocaleString();
    statTrees.textContent = forestCount.toLocaleString();

    headerSpeciesBadge.textContent = meta.name;
    headerSpeciesBadge.style.borderColor = meta.accentHex;
  };

  const applyState = (nextState: AppState): void => {
    currentState = nextState;

    syncHeroTree(nextState.activeTree);

    headerPausedBadge.hidden = !nextState.settings.paused;
    headerGhostBadge.hidden = !nextState.settings.clickThrough;

    updateHeroAndStats(
      nextState.activeTree.species,
      nextState.activeTree.id,
      nextState.activeTree.keystrokes,
      nextState.activeTree.targetKeystrokes,
      nextState.todayKeystrokes,
      nextState.totalKeystrokes,
      nextState.forest.length,
    );

    // Sync settings controls
    for (const btn of paceControl.querySelectorAll<HTMLButtonElement>('[data-pace]')) {
      const pace = Number(btn.dataset.pace) as GrowthPace;
      btn.classList.toggle('is-active', pace === nextState.settings.targetKeystrokes);
    }

    for (const btn of scaleControl.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
      const scale = Number(btn.dataset.scale) as WidgetScale;
      btn.classList.toggle('is-active', scale === nextState.settings.scale);
    }

    toggleAlwaysOnTop.checked = nextState.settings.alwaysOnTop;
    toggleClickThrough.checked = nextState.settings.clickThrough;
    togglePaused.checked = nextState.settings.paused;
    toggleLaunchLogin.checked = nextState.settings.launchAtLogin;

    // Sync active species tile
    for (const [species, refs] of speciesTiles) {
      const isActive = species === nextState.activeTree.species;
      refs.button.classList.toggle('is-active', isActive);
      refs.badge.hidden = !isActive;
    }

    if (
      pendingSpeciesSwitch &&
      (pendingSpeciesSwitch === nextState.activeTree.species ||
        getGrowthProgress(nextState.activeTree) >= 1)
    ) {
      hideSpeciesConfirm();
    }

    meadow.update(nextState.forest);
    refreshSaveInfoSoon();
  };

  // Hero button handlers
  testKeysBtn.addEventListener('click', async () => {
    const nextState = await api.simulateKeystrokes(50);
    applyState(nextState);
  });

  harvestTreeBtn.addEventListener('click', async () => {
    if (!currentState) return;
    const progress = getGrowthProgress(currentState.activeTree);
    if (progress < 1) return;
    const nextSpecies = getNextSpecies(currentState.activeTree.species);
    heroScene.triggerStageUp('ancient');
    const nextState = await api.harvestAndPlant(nextSpecies);
    applyState(nextState);
    showFeedback(`Harvested into meadow!`);
  });

  // Species confirmation bar handlers
  speciesConfirmYes.addEventListener('click', async () => {
    if (!pendingSpeciesSwitch) return;
    const chosen = pendingSpeciesSwitch;
    hideSpeciesConfirm();
    const nextState = await api.plantSpecies(chosen);
    applyState(nextState);
    showFeedback(`Planted ${SPECIES_META[chosen].name}`);
  });

  speciesConfirmNo.addEventListener('click', () => {
    hideSpeciesConfirm();
  });

  // Settings segmented controls
  paceControl.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-pace]') : null;
    if (!target) return;
    const pace = Number(target.dataset.pace) as GrowthPace;
    const nextState = await api.updateSettings({ targetKeystrokes: pace });
    applyState(nextState);
    showFeedback(`Pace: ${pace.toLocaleString()} keys`);
  });

  scaleControl.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-scale]') : null;
    if (!target) return;
    const scale = Number(target.dataset.scale) as WidgetScale;
    const nextState = await api.updateSettings({ scale });
    applyState(nextState);
    showFeedback(`Widget size: ${scale}×`);
  });

  // Settings toggles
  toggleAlwaysOnTop.addEventListener('change', async () => {
    const nextState = await api.updateSettings({ alwaysOnTop: toggleAlwaysOnTop.checked });
    applyState(nextState);
  });

  toggleClickThrough.addEventListener('change', async () => {
    const nextState = await api.updateSettings({ clickThrough: toggleClickThrough.checked });
    applyState(nextState);
    showFeedback(toggleClickThrough.checked ? 'Ghost Mode enabled' : 'Ghost Mode disabled');
  });

  togglePaused.addEventListener('change', async () => {
    const nextState = await api.updateSettings({ paused: togglePaused.checked });
    applyState(nextState);
    showFeedback(togglePaused.checked ? 'Growth paused' : 'Growth resumed');
  });

  toggleLaunchLogin.addEventListener('change', async () => {
    const nextState = await api.updateSettings({ launchAtLogin: toggleLaunchLogin.checked });
    applyState(nextState);
  });

  saveNowBtn.addEventListener('click', async () => {
    const info = await api.saveProgressNow();
    renderSaveInfo(info);
    showFeedback('Progress saved!');
  });

  openSaveFolderBtn.addEventListener('click', async () => {
    await api.openSaveFolder();
  });

  resetPositionBtn.addEventListener('click', async () => {
    await api.resetWidgetPosition();
    showFeedback('Widget position reset');
  });

  // Live IPC subscriptions
  const unsubscribeState = api.onStateUpdated((nextState) => {
    applyState(nextState);
  });

  const unsubscribeTick = api.onKeystrokeTick((payload) => {
    heroScene.onKeystroke(payload.count);
    if (!currentState) return;
    const updatedTreeKeystrokes = Math.max(
      currentState.activeTree.keystrokes,
      payload.treeKeystrokes,
    );
    const updatedTree = {
      ...currentState.activeTree,
      keystrokes: updatedTreeKeystrokes,
      targetKeystrokes: payload.targetKeystrokes,
    };
    currentState = {
      ...currentState,
      totalKeystrokes: Math.max(currentState.totalKeystrokes, payload.totalKeystrokes),
      todayKeystrokes: Math.max(currentState.todayKeystrokes, payload.todayKeystrokes),
      activeTree: updatedTree,
    };
    syncHeroTree(updatedTree);
    updateHeroAndStats(
      currentState.activeTree.species,
      currentState.activeTree.id,
      updatedTreeKeystrokes,
      payload.targetKeystrokes,
      currentState.todayKeystrokes,
      currentState.totalKeystrokes,
      currentState.forest.length,
    );
    refreshSaveInfoSoon();
  });

  heroScene.start();
  void api.getState().then(applyState);
  void api.getSaveInfo().then(renderSaveInfo);

  window.addEventListener('beforeunload', () => {
    if (feedbackTimer !== null) {
      window.clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
    if (saveRefreshTimer !== null) {
      window.clearTimeout(saveRefreshTimer);
      saveRefreshTimer = null;
    }
    unsubscribeState();
    unsubscribeTick();
    meadow.destroy();
    heroScene.destroy();
  });
}

main();
