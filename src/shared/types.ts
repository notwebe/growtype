export type SpeciesId = 'oak' | 'sakura' | 'pine' | 'maple' | 'bonsai';

export type GrowthStage = 'seed' | 'sprout' | 'sapling' | 'young' | 'full' | 'ancient';

export type WidgetScale = 2 | 3 | 4;

export type GrowthPace = 300 | 1500 | 5000;

export interface TreeRecord {
  id: string;
  species: SpeciesId;
  seed: number;
  keystrokes: number;
  targetKeystrokes: number;
  createdAt: string;
  harvestedAt?: string;
}

export interface WidgetSettings {
  alwaysOnTop: boolean;
  clickThrough: boolean;
  paused: boolean;
  scale: WidgetScale;
  targetKeystrokes: GrowthPace;
  windowPosition: { x: number; y: number } | null;
  launchAtLogin: boolean;
}

export interface AppState {
  version: 1;
  activeTree: TreeRecord;
  forest: TreeRecord[];
  totalKeystrokes: number;
  todayKeystrokes: number;
  todayDate: string; // YYYY-MM-DD local
  settings: WidgetSettings;
}

export interface KeystrokeTickPayload {
  count: number;
  totalKeystrokes: number;
  todayKeystrokes: number;
  treeKeystrokes: number;
  targetKeystrokes: number;
}

export interface SaveProgressInfo {
  filePath: string;
  lastSavedAt: string | null;
}

export interface SpeciesMeta {
  id: SpeciesId;
  name: string;
  subtitle: string;
  accentHex: string;
}

export const SPECIES_ORDER: SpeciesId[] = ['oak', 'sakura', 'pine', 'maple', 'bonsai'];

export const SPECIES_META: Record<SpeciesId, SpeciesMeta> = {
  oak: { id: 'oak', name: 'Emerald Oak', subtitle: 'Sturdy canopy, golden acorns & songbird', accentHex: '#52b788' },
  sakura: { id: 'sakura', name: 'Sakura', subtitle: 'Graceful blossoms & drifting pink petals', accentHex: '#f497b6' },
  pine: { id: 'pine', name: 'Alpine Pine', subtitle: 'Layered spruce boughs & snow-dusted tips', accentHex: '#4ea89b' },
  maple: { id: 'maple', name: 'Autumn Maple', subtitle: 'Fiery amber foliage & crimson leaves', accentHex: '#e76f51' },
  bonsai: { id: 'bonsai', name: 'Zen Bonsai', subtitle: 'Sculpted cloud pads in a ceramic tray', accentHex: '#6c9a8b' },
};

export const VIRTUAL_WIDTH = 96;
export const VIRTUAL_HEIGHT = 112;

export const STAGE_ORDER: GrowthStage[] = ['seed', 'sprout', 'sapling', 'young', 'full', 'ancient'];

export const STAGE_THRESHOLDS: Record<GrowthStage, number> = {
  seed: 0,
  sprout: 0.03,
  sapling: 0.12,
  young: 0.32,
  full: 0.62,
  ancient: 0.90,
};

export const STAGE_LABELS: Record<GrowthStage, string> = {
  seed: 'Seed',
  sprout: 'Sprout',
  sapling: 'Sapling',
  young: 'Young Tree',
  full: 'Full Canopy',
  ancient: 'Blooming Ancient',
};

export function getGrowthProgress(tree: Pick<TreeRecord, 'keystrokes' | 'targetKeystrokes'>): number {
  if (tree.targetKeystrokes <= 0) return 1;
  return Math.max(0, Math.min(1, tree.keystrokes / tree.targetKeystrokes));
}

export function getGrowthStage(progress: number): GrowthStage {
  if (progress >= STAGE_THRESHOLDS.ancient) return 'ancient';
  if (progress >= STAGE_THRESHOLDS.full) return 'full';
  if (progress >= STAGE_THRESHOLDS.young) return 'young';
  if (progress >= STAGE_THRESHOLDS.sapling) return 'sapling';
  if (progress >= STAGE_THRESHOLDS.sprout) return 'sprout';
  return 'seed';
}

export interface GrowTypeAPI {
  getState(): Promise<AppState>;
  onStateUpdated(cb: (state: AppState) => void): () => void;
  onKeystrokeTick(cb: (payload: KeystrokeTickPayload) => void): () => void;
  harvestAndPlant(nextSpecies: SpeciesId): Promise<AppState>;
  plantSpecies(species: SpeciesId): Promise<AppState>;
  simulateKeystrokes(count: number): Promise<AppState>;
  updateSettings(partial: Partial<WidgetSettings>): Promise<AppState>;
  setIgnoreMouseEvents(ignore: boolean): void;
  moveWidget(x: number, y: number): void;
  moveWidgetEnd(x: number, y: number): void;
  openForestWindow(): Promise<void>;
  resetWidgetPosition(): Promise<void>;
  saveProgressNow(): Promise<SaveProgressInfo>;
  getSaveInfo(): Promise<SaveProgressInfo>;
  openSaveFolder(): Promise<void>;
}

declare global {
  interface Window {
    growtype?: GrowTypeAPI;
  }
}
