import { Menu, type MenuItemConstructorOptions, Tray, nativeImage } from 'electron';
import {
  type AppState,
  SPECIES_META,
  STAGE_LABELS,
  type WidgetScale,
  getGrowthProgress,
  getGrowthStage,
} from '../src/shared/types';

export interface TrayHandlers {
  onOpenForest: () => void;
  onHarvest: () => void;
  onSetScale: (scale: WidgetScale) => void;
  onToggleAlwaysOnTop: () => void;
  onToggleClickThrough: () => void;
  onTogglePaused: () => void;
  onToggleLaunchAtLogin: () => void;
  onResetPosition: () => void;
  onSaveNow: () => void;
  onQuit: () => void;
}

export class GrowTypeTray {
  private readonly tray: Tray;
  private readonly handlers: TrayHandlers;

  constructor(iconPath: string, initialState: AppState, handlers: TrayHandlers) {
    this.handlers = handlers;
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon);

    this.tray.on('click', () => {
      this.handlers.onOpenForest();
    });
    this.tray.on('double-click', () => {
      this.handlers.onOpenForest();
    });

    this.update(initialState);
  }

  update(state: AppState): void {
    const { activeTree, settings } = state;
    const progress = getGrowthProgress(activeTree);
    const stage = getGrowthStage(progress);
    const speciesName = SPECIES_META[activeTree.species].name;
    const stageLabel = STAGE_LABELS[stage];
    const canHarvest = activeTree.keystrokes >= activeTree.targetKeystrokes;

    const pausedSuffix = settings.paused ? ' [Paused]' : '';
    this.tray.setToolTip(
      `GrowType — ${speciesName} (${stageLabel}: ${activeTree.keystrokes}/${activeTree.targetKeystrokes})${pausedSuffix}`
    );

    const template: MenuItemConstructorOptions[] = [
      {
        label: `${speciesName} · ${stageLabel} (${activeTree.keystrokes.toLocaleString()} / ${activeTree.targetKeystrokes.toLocaleString()})`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Forest Garden & Settings',
        click: () => this.handlers.onOpenForest(),
      },
      {
        label: 'Harvest & Plant New Tree',
        enabled: canHarvest,
        click: () => this.handlers.onHarvest(),
      },
      { type: 'separator' },
      {
        label: 'Widget Size',
        submenu: [
          {
            label: 'Small (2x)',
            type: 'radio',
            checked: settings.scale === 2,
            click: () => this.handlers.onSetScale(2),
          },
          {
            label: 'Medium (3x)',
            type: 'radio',
            checked: settings.scale === 3,
            click: () => this.handlers.onSetScale(3),
          },
          {
            label: 'Large (4x)',
            type: 'radio',
            checked: settings.scale === 4,
            click: () => this.handlers.onSetScale(4),
          },
        ],
      },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: () => this.handlers.onToggleAlwaysOnTop(),
      },
      {
        label: 'Click-Through (Ghost Mode)',
        type: 'checkbox',
        checked: settings.clickThrough,
        click: () => this.handlers.onToggleClickThrough(),
      },
      {
        label: 'Pause Growth',
        type: 'checkbox',
        checked: settings.paused,
        click: () => this.handlers.onTogglePaused(),
      },
      {
        label: 'Launch on Windows Startup',
        type: 'checkbox',
        checked: settings.launchAtLogin,
        click: () => this.handlers.onToggleLaunchAtLogin(),
      },
      { type: 'separator' },
      {
        label: 'Reset Widget Position',
        click: () => this.handlers.onResetPosition(),
      },
      {
        label: 'Save Progress Now',
        click: () => this.handlers.onSaveNow(),
      },
      {
        label: 'Quit GrowType',
        click: () => this.handlers.onQuit(),
      },
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy(): void {
    this.tray.destroy();
  }
}
