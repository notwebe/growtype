import { BrowserWindow, type Rectangle, app, ipcMain, powerMonitor, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  type AppState,
  type KeystrokeTickPayload,
  SPECIES_ORDER,
  type SpeciesId,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type WidgetScale,
  type WidgetSettings,
  getGrowthProgress,
  getGrowthStage,
} from '../src/shared/types';
import { KeyHookBridge } from './keyHookBridge';
import { StateStore } from './store';
import { GrowTypeTray } from './tray';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TRAY_ICON_PATH = path.join(PROJECT_ROOT, 'assets', 'tray-icon.png');
const KEY_HOOK_PATH = path.join(PROJECT_ROOT, 'native', 'KeyHook.exe');
const LAUNCHER_PATH = path.join(PROJECT_ROOT, 'GrowType.exe');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

const WIDGET_PAD_X = 24;
const WIDGET_PAD_Y = 52;
const WORKAREA_MARGIN = 16;
const TRAY_THROTTLE_MS = 2000;

function getWidgetSize(scale: WidgetScale): { width: number; height: number } {
  return {
    width: VIRTUAL_WIDTH * scale + WIDGET_PAD_X,
    height: VIRTUAL_HEIGHT * scale + WIDGET_PAD_Y,
  };
}

function rectsIntersect(a: Rectangle, b: Rectangle): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function clampToWorkArea(
  x: number,
  y: number,
  width: number,
  height: number,
  workArea: Rectangle
): { x: number; y: number } {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return {
    x: Math.max(workArea.x, Math.min(Math.round(x), maxX)),
    y: Math.max(workArea.y, Math.min(Math.round(y), maxY)),
  };
}

function getDefaultWidgetPosition(width: number, height: number): { x: number; y: number } {
  const workArea = screen.getPrimaryDisplay().workArea;
  return clampToWorkArea(
    workArea.x + workArea.width - width - WORKAREA_MARGIN,
    workArea.y + workArea.height - height - WORKAREA_MARGIN,
    width,
    height,
    workArea
  );
}

function resolveInitialPosition(
  saved: { x: number; y: number } | null,
  width: number,
  height: number
): { x: number; y: number } {
  if (saved) {
    const candidate: Rectangle = {
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width,
      height,
    };
    const visible = screen
      .getAllDisplays()
      .some((display) => rectsIntersect(candidate, display.workArea));
    if (visible) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return getDefaultWidgetPosition(width, height);
}

function setWidgetBounds(
  win: BrowserWindow,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const current = win.getBounds();
  if (current.width !== width || current.height !== height) {
    win.setResizable(true);
    win.setMinimumSize(1, 1);
    win.setMaximumSize(10000, 10000);
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
    win.setMinimumSize(width, height);
    win.setMaximumSize(width, height);
    win.setResizable(false);
  } else {
    win.setPosition(Math.round(x), Math.round(y));
  }
}

function syncLoginItemSettings(openAtLogin: boolean): void {
  try {
    if (fs.existsSync(LAUNCHER_PATH)) {
      app.setLoginItemSettings({
        openAtLogin,
        path: LAUNCHER_PATH,
        args: [],
      });
    } else {
      app.setLoginItemSettings(
        app.isPackaged
          ? { openAtLogin }
          : { openAtLogin, path: process.execPath, args: [PROJECT_ROOT] }
      );
    }
  } catch (err) {
    console.warn('[main] Unable to update Windows startup item:', err);
  }
}

function loadRendererPage(win: BrowserWindow, htmlFile: string): void {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const base = devUrl.replace(/\/$/, '');
    void win.loadURL(`${base}/${htmlFile}`);
  } else {
    void win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', htmlFile));
  }
}

function bootstrap(): void {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  let store: StateStore;
  let widgetWin: BrowserWindow | null = null;
  let forestWin: BrowserWindow | null = null;
  let tray: GrowTypeTray | null = null;
  let keyHookBridge: KeyHookBridge | null = null;

  let lastTrayUpdateMs = 0;
  let trayUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanupStarted = false;

  const getOpenWindows = (): BrowserWindow[] => {
    const list: BrowserWindow[] = [];
    if (widgetWin && !widgetWin.isDestroyed()) {
      list.push(widgetWin);
    }
    if (forestWin && !forestWin.isDestroyed()) {
      list.push(forestWin);
    }
    return list;
  };

  const broadcastState = (state: AppState): void => {
    for (const win of getOpenWindows()) {
      win.webContents.send('state:updated', state);
    }
  };

  const emitKeystrokeTick = (payload: KeystrokeTickPayload): void => {
    for (const win of getOpenWindows()) {
      win.webContents.send('keystroke:tick', payload);
    }
  };

  const flushTrayUpdate = (state: AppState): void => {
    if (trayUpdateTimer !== null) {
      clearTimeout(trayUpdateTimer);
      trayUpdateTimer = null;
    }
    lastTrayUpdateMs = Date.now();
    tray?.update(state);
  };

  const scheduleTrayUpdate = (forceImmediate: boolean, state: AppState): void => {
    if (!tray) {
      return;
    }
    const elapsed = Date.now() - lastTrayUpdateMs;
    if (forceImmediate || elapsed >= TRAY_THROTTLE_MS) {
      flushTrayUpdate(state);
      return;
    }
    if (trayUpdateTimer === null) {
      trayUpdateTimer = setTimeout(() => {
        trayUpdateTimer = null;
        flushTrayUpdate(store.getState());
      }, TRAY_THROTTLE_MS - elapsed);
    }
  };

  const syncWidgetMousePolicy = (settings: WidgetSettings): void => {
    if (!widgetWin || widgetWin.isDestroyed()) {
      return;
    }
    if (settings.clickThrough) {
      widgetWin.setIgnoreMouseEvents(true);
    } else {
      widgetWin.setIgnoreMouseEvents(true, { forward: true });
    }
  };

  const applySettingsUpdate = (partial: Partial<WidgetSettings>): AppState => {
    const prevSettings = store.getState().settings;
    let nextState = store.updateSettings(partial);

    if (widgetWin && !widgetWin.isDestroyed()) {
      if (nextState.settings.alwaysOnTop !== prevSettings.alwaysOnTop) {
        widgetWin.setAlwaysOnTop(nextState.settings.alwaysOnTop);
      }

      if (nextState.settings.clickThrough !== prevSettings.clickThrough) {
        syncWidgetMousePolicy(nextState.settings);
      }

      if (nextState.settings.scale !== prevSettings.scale) {
        const prevSize = getWidgetSize(prevSettings.scale);
        const nextSize = getWidgetSize(nextState.settings.scale);
        const bounds = widgetWin.getBounds();

        const anchorRight = bounds.x + prevSize.width;
        const anchorBottom = bounds.y + prevSize.height;
        const targetDisplay = screen.getDisplayMatching({
          x: bounds.x,
          y: bounds.y,
          width: prevSize.width,
          height: prevSize.height,
        });
        const clamped = clampToWorkArea(
          anchorRight - nextSize.width,
          anchorBottom - nextSize.height,
          nextSize.width,
          nextSize.height,
          targetDisplay.workArea
        );

        setWidgetBounds(widgetWin, clamped.x, clamped.y, nextSize.width, nextSize.height);

        if (nextState.settings.windowPosition !== null) {
          nextState = store.updateSettings({ windowPosition: clamped });
        }
      }
    }

    if (
      partial.launchAtLogin !== undefined &&
      nextState.settings.launchAtLogin !== prevSettings.launchAtLogin
    ) {
      syncLoginItemSettings(nextState.settings.launchAtLogin);
    }

    broadcastState(nextState);
    flushTrayUpdate(nextState);
    return nextState;
  };

  const resetWidgetPosition = (): void => {
    const current = store.getState();
    const size = getWidgetSize(current.settings.scale);
    const pos = getDefaultWidgetPosition(size.width, size.height);
    if (widgetWin && !widgetWin.isDestroyed()) {
      setWidgetBounds(widgetWin, pos.x, pos.y, size.width, size.height);
    }
    applySettingsUpdate({ windowPosition: null });
  };

  const harvestAndPlant = (nextSpecies: SpeciesId): AppState => {
    const nextState = store.harvestAndPlant(nextSpecies);
    broadcastState(nextState);
    flushTrayUpdate(nextState);
    return nextState;
  };

  const plantSpecies = (species: SpeciesId): AppState => {
    const nextState = store.plantSpecies(species);
    broadcastState(nextState);
    flushTrayUpdate(nextState);
    return nextState;
  };

  const recordTicksAndBroadcast = (count: number, forceTray = false): AppState => {
    const prev = store.getState();
    const prevStage = getGrowthStage(getGrowthProgress(prev.activeTree));
    const nextState = store.recordKeystrokes(count);
    const nextStage = getGrowthStage(getGrowthProgress(nextState.activeTree));

    emitKeystrokeTick({
      count,
      totalKeystrokes: nextState.totalKeystrokes,
      todayKeystrokes: nextState.todayKeystrokes,
      treeKeystrokes: nextState.activeTree.keystrokes,
      targetKeystrokes: nextState.activeTree.targetKeystrokes,
    });
    broadcastState(nextState);

    const becameMature =
      prev.activeTree.keystrokes < prev.activeTree.targetKeystrokes &&
      nextState.activeTree.keystrokes >= nextState.activeTree.targetKeystrokes;
    scheduleTrayUpdate(forceTray || nextStage !== prevStage || becameMature, nextState);
    return nextState;
  };

  const createWidgetWindow = (): void => {
    const state = store.getState();
    const { width, height } = getWidgetSize(state.settings.scale);
    const pos = resolveInitialPosition(state.settings.windowPosition, width, height);

    widgetWin = new BrowserWindow({
      width,
      height,
      x: pos.x,
      y: pos.y,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      alwaysOnTop: state.settings.alwaysOnTop,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    syncWidgetMousePolicy(state.settings);
    loadRendererPage(widgetWin, 'index.html');

    widgetWin.once('ready-to-show', () => {
      if (widgetWin && !widgetWin.isDestroyed()) {
        widgetWin.showInactive();
      }
    });

    widgetWin.on('closed', () => {
      widgetWin = null;
    });
  };

  const openForestWindow = (): void => {
    if (forestWin && !forestWin.isDestroyed()) {
      if (forestWin.isMinimized()) {
        forestWin.restore();
      }
      forestWin.show();
      forestWin.focus();
      return;
    }

    forestWin = new BrowserWindow({
      width: 860,
      height: 640,
      minWidth: 720,
      minHeight: 540,
      backgroundColor: '#11161c',
      autoHideMenuBar: true,
      title: 'GrowType — Forest Garden & Settings',
      icon: TRAY_ICON_PATH,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    loadRendererPage(forestWin, 'forest.html');

    forestWin.on('closed', () => {
      forestWin = null;
    });
  };

  const registerIpcHandlers = (): void => {
    ipcMain.handle('state:get', () => store.getState());

    ipcMain.handle('tree:harvestAndPlant', (_event, nextSpecies: SpeciesId) =>
      harvestAndPlant(nextSpecies)
    );

    ipcMain.handle('tree:plantSpecies', (_event, species: SpeciesId) =>
      plantSpecies(species)
    );

    ipcMain.handle('tree:simulateKeystrokes', (_event, count: number) => {
      const normalized = Math.max(0, Math.min(10000, Math.floor(Number(count) || 0)));
      if (normalized <= 0) {
        return store.getState();
      }
      return recordTicksAndBroadcast(normalized, true);
    });

    ipcMain.handle('settings:update', (_event, partial: Partial<WidgetSettings>) =>
      applySettingsUpdate(partial ?? {})
    );

    ipcMain.on('widget:setIgnoreMouse', (_event, ignore: boolean) => {
      if (!widgetWin || widgetWin.isDestroyed()) {
        return;
      }
      if (store.getState().settings.clickThrough) {
        widgetWin.setIgnoreMouseEvents(true);
      } else {
        widgetWin.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
      }
    });

    ipcMain.on('widget:move', (_event, x: number, y: number) => {
      if (!widgetWin || widgetWin.isDestroyed()) {
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      widgetWin.setPosition(Math.round(x), Math.round(y));
    });

    ipcMain.on('widget:moveEnd', (_event, x: number, y: number) => {
      if (!widgetWin || widgetWin.isDestroyed()) {
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      const { width, height } = getWidgetSize(store.getState().settings.scale);
      const display = screen.getDisplayNearestPoint({
        x: Math.round(x + width / 2),
        y: Math.round(y + height / 2),
      });
      const clamped = clampToWorkArea(x, y, width, height, display.workArea);
      setWidgetBounds(widgetWin, clamped.x, clamped.y, width, height);
      applySettingsUpdate({ windowPosition: clamped });
    });

    ipcMain.handle('window:openForest', () => {
      openForestWindow();
    });

    ipcMain.handle('widget:resetPosition', () => {
      resetWidgetPosition();
    });

    ipcMain.handle('state:saveNow', () => store.saveNow());

    ipcMain.handle('state:getSaveInfo', () => store.getSaveInfo());

    ipcMain.handle('state:openSaveFolder', () => {
      store.flushSync();
      shell.showItemInFolder(store.getSaveInfo().filePath);
    });
  };

  app.on('second-instance', () => {
    if (widgetWin && !widgetWin.isDestroyed()) {
      widgetWin.showInactive();
    }
    openForestWindow();
  });

  app.on('window-all-closed', () => {
    if (!widgetWin || widgetWin.isDestroyed()) {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (trayUpdateTimer !== null) {
      clearTimeout(trayUpdateTimer);
      trayUpdateTimer = null;
    }
    store?.flushSync();

    if (!cleanupStarted && keyHookBridge) {
      event.preventDefault();
      cleanupStarted = true;
      void keyHookBridge.stop().finally(() => {
        tray?.destroy();
        tray = null;
        app.quit();
      });
    }
  });

  app.on('will-quit', () => {
    store?.flushSync();
  });

  process.on('SIGINT', () => {
    store?.flushSync();
    app.quit();
  });

  process.on('SIGTERM', () => {
    store?.flushSync();
    app.quit();
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.growtype.app');

    const statePath = path.join(app.getPath('userData'), 'growtype-state.json');
    store = new StateStore(statePath);

    if (store.getState().settings.launchAtLogin) {
      syncLoginItemSettings(true);
    }

    powerMonitor.on('shutdown', () => {
      store?.flushSync();
    });
    powerMonitor.on('suspend', () => {
      store?.flushSync();
    });

    registerIpcHandlers();
    createWidgetWindow();

    tray = new GrowTypeTray(TRAY_ICON_PATH, store.getState(), {
      onOpenForest: () => openForestWindow(),
      onHarvest: () => {
        const current = store.getState();
        if (current.activeTree.keystrokes < current.activeTree.targetKeystrokes) {
          return;
        }
        const idx = SPECIES_ORDER.indexOf(current.activeTree.species);
        const nextSpecies = SPECIES_ORDER[(idx + 1) % SPECIES_ORDER.length];
        harvestAndPlant(nextSpecies);
      },
      onSetScale: (scale) => {
        applySettingsUpdate({ scale });
      },
      onToggleAlwaysOnTop: () => {
        const current = store.getState().settings.alwaysOnTop;
        applySettingsUpdate({ alwaysOnTop: !current });
      },
      onToggleClickThrough: () => {
        const current = store.getState().settings.clickThrough;
        applySettingsUpdate({ clickThrough: !current });
      },
      onTogglePaused: () => {
        const current = store.getState().settings.paused;
        applySettingsUpdate({ paused: !current });
      },
      onToggleLaunchAtLogin: () => {
        const current = store.getState().settings.launchAtLogin;
        applySettingsUpdate({ launchAtLogin: !current });
      },
      onResetPosition: () => {
        resetWidgetPosition();
      },
      onSaveNow: () => {
        store.saveNow();
      },
      onQuit: () => {
        app.quit();
      },
    });

    keyHookBridge = new KeyHookBridge({
      exePath: KEY_HOOK_PATH,
      onTick: () => {
        if (store.getState().settings.paused) {
          return;
        }
        recordTicksAndBroadcast(1);
      },
      onError: (err) => {
        console.error('[main] KeyHook error:', err.message);
      },
    });
    keyHookBridge.start();
  });
}

bootstrap();
