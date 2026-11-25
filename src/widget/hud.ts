import {
  AppState,
  GrowthStage,
  KeystrokeTickPayload,
  SPECIES_META,
  SPECIES_ORDER,
  STAGE_LABELS,
  STAGE_ORDER,
  SpeciesId,
  getGrowthProgress,
  getGrowthStage,
} from '../shared/types';

export interface WidgetHudOptions {
  rootEl: HTMLElement;
  pillEl: HTMLElement;
  speciesDotEl: HTMLElement;
  stageEl: HTMLElement;
  pausedEl: HTMLElement;
  countEl: HTMLElement;
  progressFillEl: HTMLElement;
  matureRowEl: HTMLElement;
  harvestBtnEl: HTMLButtonElement;
  speciesDotsEl: HTMLElement;
  forestBtnEl: HTMLButtonElement;
  toastEl: HTMLElement;
  onOpenForest: () => void;
  onHarvest: (nextSpecies: SpeciesId) => Promise<void>;
  onMilestone: (stage: GrowthStage) => void;
}

export interface WidgetHud {
  updateState(state: AppState): void;
  updateLiveKeystrokes(payload: KeystrokeTickPayload): void;
  destroy(): void;
}

const MILESTONE_MESSAGES: Record<GrowthStage, string> = {
  seed: 'Seed',
  sprout: 'Sprout!',
  sapling: 'Sapling!',
  young: 'Young Tree!',
  full: 'Full Canopy!',
  ancient: 'Blooming!',
};

function getNextSpecies(current: SpeciesId): SpeciesId {
  const index = SPECIES_ORDER.indexOf(current);
  if (index === -1) return SPECIES_ORDER[0];
  return SPECIES_ORDER[(index + 1) % SPECIES_ORDER.length];
}

export function createWidgetHud(options: WidgetHudOptions): WidgetHud {
  const {
    rootEl,
    speciesDotEl,
    stageEl,
    pausedEl,
    countEl,
    progressFillEl,
    matureRowEl,
    harvestBtnEl,
    speciesDotsEl,
    forestBtnEl,
    toastEl,
    onOpenForest,
    onHarvest,
    onMilestone,
  } = options;

  let currentState: AppState | null = null;
  let lastTreeId: string | null = null;
  let lastStage: GrowthStage = 'seed';
  let wasMature = false;
  let isHarvesting = false;
  let toastTimer: number | null = null;

  const dotButtons = new Map<SpeciesId, HTMLButtonElement>();
  for (const species of SPECIES_ORDER) {
    const meta = SPECIES_META[species];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-species-choice';
    btn.style.backgroundColor = meta.accentHex;
    btn.title = `Harvest & plant ${meta.name}`;
    btn.setAttribute('aria-label', `Harvest and plant ${meta.name}`);
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      void triggerHarvest(species);
    });
    dotButtons.set(species, btn);
    speciesDotsEl.appendChild(btn);
  }

  const showToast = (message: string): void => {
    toastEl.textContent = message;
    toastEl.classList.remove('is-visible');
    // Force reflow so rapid consecutive milestones replay the entrance animation cleanly.
    void toastEl.offsetWidth;
    toastEl.classList.add('is-visible');

    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toastEl.classList.remove('is-visible');
    }, 2400);
  };

  const evaluateMilestones = (treeId: string, keystrokes: number, targetKeystrokes: number): void => {
    const progress = getGrowthProgress({ keystrokes, targetKeystrokes });
    const stage = getGrowthStage(progress);
    const isMature = progress >= 1;

    if (lastTreeId !== treeId) {
      lastTreeId = treeId;
      lastStage = stage;
      wasMature = isMature;
      return;
    }

    const prevIndex = STAGE_ORDER.indexOf(lastStage);
    const nextIndex = STAGE_ORDER.indexOf(stage);

    if (isMature && !wasMature) {
      onMilestone(stage);
      showToast('Ready to Harvest!');
    } else if (nextIndex > prevIndex) {
      onMilestone(stage);
      showToast(MILESTONE_MESSAGES[stage]);
    }

    lastStage = stage;
    wasMature = isMature;
  };

  const renderProgress = (species: SpeciesId, keystrokes: number, targetKeystrokes: number): void => {
    const progress = getGrowthProgress({ keystrokes, targetKeystrokes });
    const stage = getGrowthStage(progress);
    const isMature = progress >= 1;
    const meta = SPECIES_META[species];

    rootEl.style.setProperty('--species-accent', meta.accentHex);
    rootEl.classList.toggle('is-mature', isMature);

    speciesDotEl.style.backgroundColor = meta.accentHex;
    stageEl.textContent = STAGE_LABELS[stage];
    countEl.textContent = `${keystrokes.toLocaleString()} / ${targetKeystrokes.toLocaleString()}`;
    progressFillEl.style.width = `${(progress * 100).toFixed(2)}%`;

    matureRowEl.hidden = !isMature;
    const nextSpecies = getNextSpecies(species);
    harvestBtnEl.title = `Harvest into forest & plant ${SPECIES_META[nextSpecies].name}`;
    for (const [dotSpecies, btn] of dotButtons) {
      btn.classList.toggle('is-next', dotSpecies === nextSpecies);
    }
  };

  const triggerHarvest = async (nextSpecies: SpeciesId): Promise<void> => {
    if (isHarvesting) return;
    isHarvesting = true;
    harvestBtnEl.disabled = true;
    for (const btn of dotButtons.values()) {
      btn.disabled = true;
    }
    try {
      await onHarvest(nextSpecies);
      showToast(`Planted ${SPECIES_META[nextSpecies].name}!`);
    } finally {
      isHarvesting = false;
      harvestBtnEl.disabled = false;
      for (const btn of dotButtons.values()) {
        btn.disabled = false;
      }
    }
  };

  const handleForestClick = (event: MouseEvent): void => {
    event.stopPropagation();
    onOpenForest();
  };

  const handleHarvestClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (!currentState) return;
    const nextSpecies = getNextSpecies(currentState.activeTree.species);
    void triggerHarvest(nextSpecies);
  };

  forestBtnEl.addEventListener('click', handleForestClick);
  harvestBtnEl.addEventListener('click', handleHarvestClick);

  return {
    updateState(state: AppState): void {
      currentState = state;
      pausedEl.hidden = !state.settings.paused;
      rootEl.classList.toggle('is-ghost', state.settings.clickThrough);

      const { activeTree } = state;
      evaluateMilestones(activeTree.id, activeTree.keystrokes, activeTree.targetKeystrokes);
      renderProgress(activeTree.species, activeTree.keystrokes, activeTree.targetKeystrokes);
    },

    updateLiveKeystrokes(payload: KeystrokeTickPayload): void {
      if (!currentState) return;
      const updatedKeystrokes = Math.max(currentState.activeTree.keystrokes, payload.treeKeystrokes);
      currentState = {
        ...currentState,
        totalKeystrokes: payload.totalKeystrokes,
        todayKeystrokes: payload.todayKeystrokes,
        activeTree: {
          ...currentState.activeTree,
          keystrokes: updatedKeystrokes,
          targetKeystrokes: payload.targetKeystrokes,
        },
      };
      evaluateMilestones(
        currentState.activeTree.id,
        updatedKeystrokes,
        payload.targetKeystrokes,
      );
      renderProgress(
        currentState.activeTree.species,
        updatedKeystrokes,
        payload.targetKeystrokes,
      );
    },

    destroy(): void {
      forestBtnEl.removeEventListener('click', handleForestClick);
      harvestBtnEl.removeEventListener('click', handleHarvestClick);
      if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
      }
    },
  };
}
