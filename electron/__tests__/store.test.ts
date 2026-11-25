import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StateStore, getLocalDateString } from '../store';

const tempDirs: string[] = [];
const stores: StateStore[] = [];

function makeTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growtype-store-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('StateStore', () => {
  it('initializes with expected default state', () => {
    const fixedNow = new Date(2026, 10, 24, 14, 30, 0);
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath, { now: () => fixedNow });
    stores.push(store);

    const state = store.getState();
    expect(state.version).toBe(1);
    expect(state.activeTree.species).toBe('oak');
    expect(state.activeTree.keystrokes).toBe(0);
    expect(state.activeTree.targetKeystrokes).toBe(1500);
    expect(state.activeTree.seed).toBeGreaterThan(0);
    expect(state.forest).toEqual([]);
    expect(state.totalKeystrokes).toBe(0);
    expect(state.todayKeystrokes).toBe(0);
    expect(state.todayDate).toBe(getLocalDateString(fixedNow));
    expect(state.settings).toEqual({
      alwaysOnTop: true,
      clickThrough: false,
      paused: false,
      scale: 3,
      targetKeystrokes: 1500,
      windowPosition: null,
      launchAtLogin: false,
    });
  });

  it('saves atomically and reloads persisted state', () => {
    const fixedNow = new Date(2026, 10, 24, 10, 0, 0);
    const filePath = makeTempStatePath();

    const store1 = new StateStore(filePath, { now: () => fixedNow });
    stores.push(store1);
    store1.recordKeystrokes(42);
    store1.flushSync();

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);

    const store2 = new StateStore(filePath, { now: () => fixedNow });
    stores.push(store2);
    const reloaded = store2.getState();

    expect(reloaded.activeTree.keystrokes).toBe(42);
    expect(reloaded.totalKeystrokes).toBe(42);
    expect(reloaded.todayKeystrokes).toBe(42);
    expect(reloaded.activeTree.id).toBe(store1.getState().activeTree.id);
  });

  it('resets todayKeystrokes on midnight rollover during keystrokes and on reload', () => {
    let current = new Date(2026, 10, 24, 23, 59, 50);
    const filePath = makeTempStatePath();

    const store = new StateStore(filePath, { now: () => current });
    stores.push(store);
    store.recordKeystrokes(120);
    expect(store.getState().todayKeystrokes).toBe(120);
    expect(store.getState().todayDate).toBe('2026-11-24');

    // Cross midnight locally
    current = new Date(2026, 10, 25, 0, 0, 5);
    const afterMidnight = store.recordKeystrokes(7);
    expect(afterMidnight.todayDate).toBe('2026-11-25');
    expect(afterMidnight.todayKeystrokes).toBe(7);
    expect(afterMidnight.totalKeystrokes).toBe(127);
    expect(afterMidnight.activeTree.keystrokes).toBe(127);
    store.flushSync();

    // Reloading on the next day resets todayKeystrokes to 0
    const nextDay = new Date(2026, 10, 26, 9, 0, 0);
    const reloadedStore = new StateStore(filePath, { now: () => nextDay });
    stores.push(reloadedStore);
    const reloaded = reloadedStore.getState();
    expect(reloaded.todayDate).toBe('2026-11-26');
    expect(reloaded.todayKeystrokes).toBe(0);
    expect(reloaded.totalKeystrokes).toBe(127);
    expect(reloaded.activeTree.keystrokes).toBe(127);
  });

  it('harvestAndPlant moves active tree to forest and flushes immediately', () => {
    let current = new Date(2026, 10, 24, 12, 0, 0);
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath, { now: () => current });
    stores.push(store);

    store.recordKeystrokes(1500);
    const oldTreeId = store.getState().activeTree.id;

    current = new Date(2026, 10, 24, 12, 30, 0);
    const nextState = store.harvestAndPlant('sakura');

    expect(nextState.forest).toHaveLength(1);
    expect(nextState.forest[0].id).toBe(oldTreeId);
    expect(nextState.forest[0].species).toBe('oak');
    expect(nextState.forest[0].keystrokes).toBe(1500);
    expect(nextState.forest[0].harvestedAt).toBe(current.toISOString());

    expect(nextState.activeTree.id).not.toBe(oldTreeId);
    expect(nextState.activeTree.species).toBe('sakura');
    expect(nextState.activeTree.keystrokes).toBe(0);
    expect(nextState.activeTree.targetKeystrokes).toBe(1500);

    // Must already be flushed to disk synchronously
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(raw.forest).toHaveLength(1);
    expect(raw.activeTree.species).toBe('sakura');
  });

  it('plantSpecies replaces active tree without adding to forest and flushes', () => {
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath);
    stores.push(store);

    store.recordKeystrokes(250);
    const prevId = store.getState().activeTree.id;
    const next = store.plantSpecies('bonsai');

    expect(next.forest).toHaveLength(0);
    expect(next.activeTree.id).not.toBe(prevId);
    expect(next.activeTree.species).toBe('bonsai');
    expect(next.activeTree.keystrokes).toBe(0);
    expect(next.totalKeystrokes).toBe(250);

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(raw.activeTree.species).toBe('bonsai');
  });

  it('updateSettings merges settings and updates activeTree.targetKeystrokes when pace changes', () => {
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath);
    stores.push(store);

    const updated = store.updateSettings({
      scale: 4,
      alwaysOnTop: false,
      clickThrough: true,
      paused: true,
      launchAtLogin: true,
      windowPosition: { x: 120, y: 240 },
      targetKeystrokes: 300,
    });

    expect(updated.settings).toEqual({
      scale: 4,
      alwaysOnTop: false,
      clickThrough: true,
      paused: true,
      launchAtLogin: true,
      windowPosition: { x: 120, y: 240 },
      targetKeystrokes: 300,
    });
    expect(updated.activeTree.targetKeystrokes).toBe(300);

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(raw.activeTree.targetKeystrokes).toBe(300);
    expect(raw.settings.scale).toBe(4);
  });

  it('creates initial save file on startup and reports save info', () => {
    const fixedNow = new Date(2026, 10, 24, 15, 0, 0);
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath, { now: () => fixedNow });
    stores.push(store);

    expect(fs.existsSync(filePath)).toBe(true);
    const info = store.getSaveInfo();
    expect(info.filePath).toBe(filePath);
    expect(info.lastSavedAt).toBe(fixedNow.toISOString());
  });

  it('flushes progress during sustained typing via maxWaitMs without debounce starvation', async () => {
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath, { debounceMs: 90, maxWaitMs: 130 });
    stores.push(store);

    for (let i = 0; i < 6; i++) {
      store.recordKeystrokes(1);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }

    const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(disk.activeTree.keystrokes).toBeGreaterThanOrEqual(3);
    expect(disk.activeTree.keystrokes).toBeLessThanOrEqual(6);
    expect(store.getSaveInfo().lastSavedAt).not.toBeNull();
  });

  it('recovers from .bak when primary state file is corrupted', () => {
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath);
    stores.push(store);

    store.recordKeystrokes(75);
    store.flushSync();
    store.recordKeystrokes(25);
    store.flushSync();

    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);

    // Corrupt primary save file on disk
    fs.writeFileSync(filePath, '{corrupted json!!!', 'utf8');

    const recovered = new StateStore(filePath);
    stores.push(recovered);
    expect(recovered.getState().activeTree.keystrokes).toBe(75);
    expect(recovered.getState().totalKeystrokes).toBe(75);

    // Primary file should be repaired automatically on load
    const repaired = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(repaired.activeTree.keystrokes).toBe(75);
  });

  it('saveNow persists immediately and updates lastSavedAt', () => {
    let current = new Date(2026, 10, 24, 16, 0, 0);
    const filePath = makeTempStatePath();
    const store = new StateStore(filePath, { now: () => current, debounceMs: 5000, maxWaitMs: 5000 });
    stores.push(store);

    store.recordKeystrokes(18);
    current = new Date(2026, 10, 24, 16, 1, 0);
    const info = store.saveNow();

    expect(info.filePath).toBe(filePath);
    expect(info.lastSavedAt).toBe(current.toISOString());

    const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(disk.activeTree.keystrokes).toBe(18);
  });
});
