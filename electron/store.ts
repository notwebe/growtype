import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type AppState,
  type GrowthPace,
  SPECIES_ORDER,
  type SaveProgressInfo,
  type SpeciesId,
  type TreeRecord,
  type WidgetScale,
  type WidgetSettings,
} from '../src/shared/types';

export interface StateStoreOptions {
  now?: () => Date;
  debounceMs?: number;
  maxWaitMs?: number;
}

const VALID_SPECIES = new Set<SpeciesId>(SPECIES_ORDER);
const VALID_SCALES = new Set<WidgetScale>([2, 3, 4]);
const VALID_PACES = new Set<GrowthPace>([300, 1500, 5000]);

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidSpecies(value: unknown): value is SpeciesId {
  return typeof value === 'string' && VALID_SPECIES.has(value as SpeciesId);
}

function isValidScale(value: unknown): value is WidgetScale {
  return typeof value === 'number' && VALID_SCALES.has(value as WidgetScale);
}

function isValidGrowthPace(value: unknown): value is GrowthPace {
  return typeof value === 'number' && VALID_PACES.has(value as GrowthPace);
}

function generateRandomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

function sanitizeNonNegInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function sanitizeWindowPosition(value: unknown): { x: number; y: number } | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { x?: unknown }).x === 'number' &&
    Number.isFinite((value as { x: number }).x) &&
    typeof (value as { y?: unknown }).y === 'number' &&
    Number.isFinite((value as { y: number }).y)
  ) {
    return {
      x: Math.round((value as { x: number }).x),
      y: Math.round((value as { y: number }).y),
    };
  }
  return null;
}

export function createDefaultSettings(): WidgetSettings {
  return {
    alwaysOnTop: true,
    clickThrough: false,
    paused: false,
    scale: 3,
    targetKeystrokes: 1500,
    windowPosition: null,
    launchAtLogin: false,
  };
}

export function createTreeRecord(
  species: SpeciesId = 'oak',
  targetKeystrokes: GrowthPace = 1500,
  now: Date = new Date()
): TreeRecord {
  return {
    id: randomUUID(),
    species: isValidSpecies(species) ? species : 'oak',
    seed: generateRandomSeed(),
    keystrokes: 0,
    targetKeystrokes,
    createdAt: now.toISOString(),
  };
}

export function createDefaultState(now: Date = new Date()): AppState {
  const settings = createDefaultSettings();
  return {
    version: 1,
    activeTree: createTreeRecord('oak', settings.targetKeystrokes, now),
    forest: [],
    totalKeystrokes: 0,
    todayKeystrokes: 0,
    todayDate: getLocalDateString(now),
    settings,
  };
}

function sanitizeTreeRecord(
  raw: unknown,
  fallbackTarget: GrowthPace,
  now: Date
): TreeRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const species = isValidSpecies(obj.species) ? obj.species : 'oak';
  const targetKeystrokes = isValidGrowthPace(obj.targetKeystrokes)
    ? obj.targetKeystrokes
    : fallbackTarget;

  const record: TreeRecord = {
    id: typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : randomUUID(),
    species,
    seed:
      typeof obj.seed === 'number' && Number.isFinite(obj.seed) && obj.seed > 0
        ? Math.floor(obj.seed)
        : generateRandomSeed(),
    keystrokes: sanitizeNonNegInt(obj.keystrokes, 0),
    targetKeystrokes,
    createdAt:
      typeof obj.createdAt === 'string' && obj.createdAt.length > 0
        ? obj.createdAt
        : now.toISOString(),
  };

  if (typeof obj.harvestedAt === 'string' && obj.harvestedAt.length > 0) {
    record.harvestedAt = obj.harvestedAt;
  }

  return record;
}

function cloneState(state: AppState): AppState {
  return {
    version: 1,
    activeTree: { ...state.activeTree },
    forest: state.forest.map((tree) => ({ ...tree })),
    totalKeystrokes: state.totalKeystrokes,
    todayKeystrokes: state.todayKeystrokes,
    todayDate: state.todayDate,
    settings: {
      ...state.settings,
      windowPosition: state.settings.windowPosition
        ? { ...state.settings.windowPosition }
        : null,
    },
  };
}

function tryParseStateFile(targetPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  try {
    const rawText = fs.readFileSync(targetPath, 'utf8');
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class StateStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private state: AppState;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedAt: string | null = null;

  constructor(filePath: string, options: StateStoreOptions = {}) {
    this.filePath = filePath;
    this.now = options.now ?? (() => new Date());
    this.debounceMs = options.debounceMs ?? 500;
    this.maxWaitMs = options.maxWaitMs ?? 2000;
    this.state = this.loadInitialState();
    if (this.dirty || !fs.existsSync(this.filePath)) {
      this.dirty = true;
      this.flushSync();
    }
  }

  private loadInitialState(): AppState {
    const currentNow = this.now();
    const currentDate = getLocalDateString(currentNow);
    const defaults = createDefaultState(currentNow);

    const backupPath = `${this.filePath}.bak`;
    let parsed = tryParseStateFile(this.filePath);
    let loadedFromPrimary = parsed !== null;

    if (!parsed) {
      parsed = tryParseStateFile(backupPath);
      if (parsed) {
        this.dirty = true;
      }
    }

    if (!parsed) {
      this.dirty = true;
      return defaults;
    }

    if (loadedFromPrimary) {
      try {
        this.lastSavedAt = fs.statSync(this.filePath).mtime.toISOString();
      } catch {
        this.lastSavedAt = null;
      }
    }

    const rawSettings =
      parsed.settings && typeof parsed.settings === 'object'
        ? (parsed.settings as Record<string, unknown>)
        : {};

    const settings: WidgetSettings = {
      alwaysOnTop:
        typeof rawSettings.alwaysOnTop === 'boolean'
          ? rawSettings.alwaysOnTop
          : defaults.settings.alwaysOnTop,
      clickThrough:
        typeof rawSettings.clickThrough === 'boolean'
          ? rawSettings.clickThrough
          : defaults.settings.clickThrough,
      paused:
        typeof rawSettings.paused === 'boolean'
          ? rawSettings.paused
          : defaults.settings.paused,
      scale: isValidScale(rawSettings.scale) ? rawSettings.scale : defaults.settings.scale,
      targetKeystrokes: isValidGrowthPace(rawSettings.targetKeystrokes)
        ? rawSettings.targetKeystrokes
        : defaults.settings.targetKeystrokes,
      windowPosition: sanitizeWindowPosition(rawSettings.windowPosition),
      launchAtLogin:
        typeof rawSettings.launchAtLogin === 'boolean'
          ? rawSettings.launchAtLogin
          : defaults.settings.launchAtLogin,
    };

    const activeTree =
      sanitizeTreeRecord(parsed.activeTree, settings.targetKeystrokes, currentNow) ??
      createTreeRecord('oak', settings.targetKeystrokes, currentNow);

    const rawForest = Array.isArray(parsed.forest) ? parsed.forest : [];
    const forest: TreeRecord[] = [];
    for (const item of rawForest) {
      const sanitized = sanitizeTreeRecord(item, settings.targetKeystrokes, currentNow);
      if (sanitized) {
        forest.push(sanitized);
      }
    }

    const totalKeystrokes = sanitizeNonNegInt(parsed.totalKeystrokes, 0);
    const savedDate = typeof parsed.todayDate === 'string' ? parsed.todayDate : '';
    const rolledOver = savedDate !== currentDate;
    const todayKeystrokes = rolledOver ? 0 : sanitizeNonNegInt(parsed.todayKeystrokes, 0);

    if (rolledOver) {
      this.dirty = true;
    }

    return {
      version: 1,
      activeTree,
      forest,
      totalKeystrokes,
      todayKeystrokes,
      todayDate: currentDate,
      settings,
    };
  }

  private ensureCurrentDate(): boolean {
    const currentDate = getLocalDateString(this.now());
    if (this.state.todayDate !== currentDate) {
      this.state.todayDate = currentDate;
      this.state.todayKeystrokes = 0;
      this.dirty = true;
      return true;
    }
    return false;
  }

  getState(): AppState {
    if (this.ensureCurrentDate()) {
      this.saveSoon();
    }
    return cloneState(this.state);
  }

  recordKeystrokes(count: number): AppState {
    this.ensureCurrentDate();
    const increment = Number.isFinite(count) ? Math.floor(count) : 0;
    if (increment > 0) {
      this.state.activeTree.keystrokes += increment;
      this.state.totalKeystrokes += increment;
      this.state.todayKeystrokes += increment;
      this.saveSoon();
    }
    return cloneState(this.state);
  }

  harvestAndPlant(nextSpecies: SpeciesId): AppState {
    if (!isValidSpecies(nextSpecies)) {
      throw new Error(`Invalid species: ${String(nextSpecies)}`);
    }
    const now = this.now();
    this.ensureCurrentDate();

    const harvested: TreeRecord = {
      ...this.state.activeTree,
      harvestedAt: now.toISOString(),
    };
    this.state.forest.push(harvested);
    this.state.activeTree = createTreeRecord(
      nextSpecies,
      this.state.settings.targetKeystrokes,
      now
    );

    this.dirty = true;
    this.flushSync();
    return cloneState(this.state);
  }

  plantSpecies(species: SpeciesId): AppState {
    if (!isValidSpecies(species)) {
      throw new Error(`Invalid species: ${String(species)}`);
    }
    const now = this.now();
    this.ensureCurrentDate();

    this.state.activeTree = createTreeRecord(
      species,
      this.state.settings.targetKeystrokes,
      now
    );

    this.dirty = true;
    this.flushSync();
    return cloneState(this.state);
  }

  updateSettings(partial: Partial<WidgetSettings>): AppState {
    this.ensureCurrentDate();
    const next = this.state.settings;

    if (typeof partial.alwaysOnTop === 'boolean') {
      next.alwaysOnTop = partial.alwaysOnTop;
    }
    if (typeof partial.clickThrough === 'boolean') {
      next.clickThrough = partial.clickThrough;
    }
    if (typeof partial.paused === 'boolean') {
      next.paused = partial.paused;
    }
    if (typeof partial.launchAtLogin === 'boolean') {
      next.launchAtLogin = partial.launchAtLogin;
    }
    if (isValidScale(partial.scale)) {
      next.scale = partial.scale;
    }
    if (partial.windowPosition !== undefined) {
      next.windowPosition = sanitizeWindowPosition(partial.windowPosition);
    }
    if (partial.targetKeystrokes !== undefined && isValidGrowthPace(partial.targetKeystrokes)) {
      next.targetKeystrokes = partial.targetKeystrokes;
      this.state.activeTree.targetKeystrokes = partial.targetKeystrokes;
    }

    this.dirty = true;
    this.flushSync();
    return cloneState(this.state);
  }

  getSaveInfo(): SaveProgressInfo {
    return {
      filePath: this.filePath,
      lastSavedAt: this.lastSavedAt,
    };
  }

  saveNow(): SaveProgressInfo {
    this.dirty = true;
    this.flushSync();
    return this.getSaveInfo();
  }

  saveSoon(): void {
    this.dirty = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSync();
    }, this.debounceMs);

    if (this.maxWaitTimer === null) {
      const maxWait = Math.max(0, this.maxWaitMs);
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        this.flushSync();
      }, maxWait);
    }
  }

  flushSync(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (!this.dirty && fs.existsSync(this.filePath)) {
      return;
    }

    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    const serialized = JSON.stringify(this.state, null, 2);
    fs.writeFileSync(tmpPath, serialized, 'utf8');

    if (fs.existsSync(this.filePath)) {
      try {
        fs.copyFileSync(this.filePath, backupPath);
      } catch {
        // Best-effort backup before swap.
      }
    }

    let renamed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(tmpPath, this.filePath);
        renamed = true;
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'EPERM' && code !== 'EBUSY') {
          throw err;
        }
      }
    }

    if (!renamed) {
      fs.copyFileSync(tmpPath, this.filePath);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup of temp file.
      }
    }

    this.lastSavedAt = this.now().toISOString();
    this.dirty = false;
  }

  dispose(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }
}
