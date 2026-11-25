import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppState,
  GrowTypeAPI,
  KeystrokeTickPayload,
  SpeciesId,
  WidgetSettings,
} from '../src/shared/types';

const api: GrowTypeAPI = {
  getState: () => ipcRenderer.invoke('state:get'),

  onStateUpdated: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => {
      cb(state);
    };
    ipcRenderer.on('state:updated', listener);
    return () => {
      ipcRenderer.removeListener('state:updated', listener);
    };
  },

  onKeystrokeTick: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: KeystrokeTickPayload) => {
      cb(payload);
    };
    ipcRenderer.on('keystroke:tick', listener);
    return () => {
      ipcRenderer.removeListener('keystroke:tick', listener);
    };
  },

  harvestAndPlant: (nextSpecies: SpeciesId) =>
    ipcRenderer.invoke('tree:harvestAndPlant', nextSpecies),

  plantSpecies: (species: SpeciesId) =>
    ipcRenderer.invoke('tree:plantSpecies', species),

  simulateKeystrokes: (count: number) =>
    ipcRenderer.invoke('tree:simulateKeystrokes', count),

  updateSettings: (partial: Partial<WidgetSettings>) =>
    ipcRenderer.invoke('settings:update', partial),

  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('widget:setIgnoreMouse', ignore);
  },

  moveWidget: (x: number, y: number) => {
    ipcRenderer.send('widget:move', x, y);
  },

  moveWidgetEnd: (x: number, y: number) => {
    ipcRenderer.send('widget:moveEnd', x, y);
  },

  openForestWindow: () => ipcRenderer.invoke('window:openForest'),

  resetWidgetPosition: () => ipcRenderer.invoke('widget:resetPosition'),

  saveProgressNow: () => ipcRenderer.invoke('state:saveNow'),

  getSaveInfo: () => ipcRenderer.invoke('state:getSaveInfo'),

  openSaveFolder: () => ipcRenderer.invoke('state:openSaveFolder'),
};

contextBridge.exposeInMainWorld('growtype', api);
