import {
  AppState,
  GrowTypeAPI,
  KeystrokeTickPayload,
  SPECIES_META,
  SaveProgressInfo,
  SpeciesId,
  TreeRecord,
  WidgetSettings,
} from '../shared/types';

const STORAGE_KEY = 'growtype:browser-preview-state:v1';

const IGNORED_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createTreeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tree-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function createSeed(): number {
  return Math.floor(1 + Math.random() * 2_147_483_646);
}

function createTreeRecord(species: SpeciesId, targetKeystrokes: number): TreeRecord {
  return {
    id: createTreeId(),
    species,
    seed: createSeed(),
    keystrokes: 0,
    targetKeystrokes,
    createdAt: new Date().toISOString(),
  };
}

function createDefaultState(): AppState {
  const settings: WidgetSettings = {
    alwaysOnTop: true,
    clickThrough: false,
    paused: false,
    scale: 3,
    targetKeystrokes: 1500,
    windowPosition: null,
    launchAtLogin: false,
  };

  return {
    version: 1,
    activeTree: createTreeRecord('oak', settings.targetKeystrokes),
    forest: [],
    totalKeystrokes: 0,
    todayKeystrokes: 0,
    todayDate: getLocalDateString(),
    settings,
  };
}

function normalizeState(raw: unknown): AppState {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<AppState>;
  const todayDate = getLocalDateString();

  const rawSettings: Partial<WidgetSettings> =
    candidate.settings && typeof candidate.settings === 'object' ? candidate.settings : {};

  const scale = rawSettings.scale === 2 || rawSettings.scale === 3 || rawSettings.scale === 4
    ? rawSettings.scale
    : fallback.settings.scale;

  const targetKeystrokes =
    rawSettings.targetKeystrokes === 300 ||
    rawSettings.targetKeystrokes === 1500 ||
    rawSettings.targetKeystrokes === 5000
      ? rawSettings.targetKeystrokes
      : fallback.settings.targetKeystrokes;

  const settings: WidgetSettings = {
    alwaysOnTop: typeof rawSettings.alwaysOnTop === 'boolean' ? rawSettings.alwaysOnTop : true,
    clickThrough: typeof rawSettings.clickThrough === 'boolean' ? rawSettings.clickThrough : false,
    paused: typeof rawSettings.paused === 'boolean' ? rawSettings.paused : false,
    scale,
    targetKeystrokes,
    windowPosition:
      rawSettings.windowPosition &&
      typeof rawSettings.windowPosition.x === 'number' &&
      typeof rawSettings.windowPosition.y === 'number'
        ? rawSettings.windowPosition
        : null,
    launchAtLogin: typeof rawSettings.launchAtLogin === 'boolean' ? rawSettings.launchAtLogin : false,
  };

  const validSpecies = (s: unknown): s is SpeciesId =>
    typeof s === 'string' && s in SPECIES_META;

  const rawTree = candidate.activeTree;
  const activeTree: TreeRecord =
    rawTree && typeof rawTree === 'object' && validSpecies(rawTree.species)
      ? {
          id: typeof rawTree.id === 'string' ? rawTree.id : createTreeId(),
          species: rawTree.species,
          seed: typeof rawTree.seed === 'number' ? rawTree.seed : createSeed(),
          keystrokes: typeof rawTree.keystrokes === 'number' ? Math.max(0, rawTree.keystrokes) : 0,
          targetKeystrokes: settings.targetKeystrokes,
          createdAt: typeof rawTree.createdAt === 'string' ? rawTree.createdAt : new Date().toISOString(),
        }
      : createTreeRecord('oak', settings.targetKeystrokes);

  const forest: TreeRecord[] = Array.isArray(candidate.forest)
    ? candidate.forest.filter(
        (t): t is TreeRecord => Boolean(t && typeof t === 'object' && validSpecies(t.species)),
      )
    : [];

  const sameDay = candidate.todayDate === todayDate;

  return {
    version: 1,
    activeTree,
    forest,
    totalKeystrokes:
      typeof candidate.totalKeystrokes === 'number' ? Math.max(0, candidate.totalKeystrokes) : 0,
    todayKeystrokes: sameDay && typeof candidate.todayKeystrokes === 'number'
      ? Math.max(0, candidate.todayKeystrokes)
      : 0,
    todayDate,
    settings,
  };
}

let cachedFallbackApi: GrowTypeAPI | null = null;

function createBrowserFallbackApi(): GrowTypeAPI {
  const stateListeners = new Set<(state: AppState) => void>();
  const tickListeners = new Set<(payload: KeystrokeTickPayload) => void>();

  const loadState = (): AppState => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      return normalizeState(JSON.parse(raw));
    } catch {
      return createDefaultState();
    }
  };

  let lastSavedAt: string | null = null;
  try {
    if (window.localStorage.getItem(STORAGE_KEY)) {
      lastSavedAt = new Date().toISOString();
    }
  } catch {
    // Ignore storage access errors.
  }

  let state: AppState = loadState();

  const persist = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      lastSavedAt = new Date().toISOString();
    } catch {
      // Ignore storage quota errors in restricted preview contexts.
    }
  };

  const cloneState = (): AppState => structuredClone(state);

  const emitState = () => {
    const snapshot = cloneState();
    for (const listener of stateListeners) {
      listener(snapshot);
    }
  };

  const ensureCurrentDay = () => {
    const today = getLocalDateString();
    if (state.todayDate !== today) {
      state.todayDate = today;
      state.todayKeystrokes = 0;
    }
  };

  const applyKeystrokes = (count: number) => {
    if (count <= 0) return;
    ensureCurrentDay();
    state.totalKeystrokes += count;
    state.todayKeystrokes += count;
    state.activeTree.keystrokes += count;
    persist();

    const tickPayload: KeystrokeTickPayload = {
      count,
      totalKeystrokes: state.totalKeystrokes,
      todayKeystrokes: state.todayKeystrokes,
      treeKeystrokes: state.activeTree.keystrokes,
      targetKeystrokes: state.activeTree.targetKeystrokes,
    };
    for (const listener of tickListeners) {
      listener(tickPayload);
    }
    emitState();
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (IGNORED_KEYS.has(event.key)) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (state.settings.paused) return;
    applyKeystrokes(1);
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      state = loadState();
      emitState();
    }
  });

  return {
    async getState(): Promise<AppState> {
      ensureCurrentDay();
      persist();
      return cloneState();
    },

    onStateUpdated(cb: (nextState: AppState) => void): () => void {
      stateListeners.add(cb);
      return () => {
        stateListeners.delete(cb);
      };
    },

    onKeystrokeTick(cb: (payload: KeystrokeTickPayload) => void): () => void {
      tickListeners.add(cb);
      return () => {
        tickListeners.delete(cb);
      };
    },

    async harvestAndPlant(nextSpecies: SpeciesId): Promise<AppState> {
      ensureCurrentDay();
      const harvested: TreeRecord = {
        ...state.activeTree,
        harvestedAt: new Date().toISOString(),
      };
      state.forest = [...state.forest, harvested];
      state.activeTree = createTreeRecord(nextSpecies, state.settings.targetKeystrokes);
      persist();
      emitState();
      return cloneState();
    },

    async plantSpecies(species: SpeciesId): Promise<AppState> {
      ensureCurrentDay();
      state.activeTree = createTreeRecord(species, state.settings.targetKeystrokes);
      persist();
      emitState();
      return cloneState();
    },

    async simulateKeystrokes(count: number): Promise<AppState> {
      const safeCount = Math.max(0, Math.floor(count));
      if (safeCount > 0) {
        applyKeystrokes(safeCount);
      }
      return cloneState();
    },

    async updateSettings(partial: Partial<WidgetSettings>): Promise<AppState> {
      ensureCurrentDay();
      state.settings = {
        ...state.settings,
        ...partial,
      };
      if (partial.targetKeystrokes !== undefined) {
        state.activeTree.targetKeystrokes = partial.targetKeystrokes;
      }
      persist();
      emitState();
      return cloneState();
    },

    setIgnoreMouseEvents(): void {
      // No-op in standalone browser preview.
    },

    moveWidget(): void {
      // No-op in standalone browser preview.
    },

    moveWidgetEnd(x: number, y: number): void {
      state.settings.windowPosition = { x: Math.round(x), y: Math.round(y) };
      persist();
      emitState();
    },

    async openForestWindow(): Promise<void> {
      const opened = window.open('./forest.html', 'growtype-forest');
      if (!opened) {
        window.location.href = './forest.html';
      }
    },

    async resetWidgetPosition(): Promise<void> {
      state.settings.windowPosition = null;
      persist();
      emitState();
    },

    async saveProgressNow(): Promise<SaveProgressInfo> {
      persist();
      return {
        filePath: 'Browser localStorage',
        lastSavedAt,
      };
    },

    async getSaveInfo(): Promise<SaveProgressInfo> {
      return {
        filePath: 'Browser localStorage',
        lastSavedAt,
      };
    },

    async openSaveFolder(): Promise<void> {
      // No-op in standalone browser preview.
    },
  };
}

export function getGrowTypeAPI(): GrowTypeAPI {
  if (window.growtype) {
    return window.growtype;
  }
  if (!cachedFallbackApi) {
    cachedFallbackApi = createBrowserFallbackApi();
  }
  return cachedFallbackApi;
}
