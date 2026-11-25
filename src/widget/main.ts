import { GrowthStage, SpeciesId, TreeScene } from '../engine';
import { AppState } from '../shared/types';
import { getGrowTypeAPI } from './browserFallback';
import { createDragController } from './dragController';
import { createWidgetHud } from './hud';

const HOVER_HIDE_DELAY_MS = 350;
const HIT_RADIUS_PX = 8;

function mustElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required widget element #${id}`);
  }
  return el as T;
}

function isPointInsideRect(x: number, y: number, rect: DOMRect, marginPx = 0): boolean {
  return (
    x >= rect.left - marginPx &&
    x <= rect.right + marginPx &&
    y >= rect.top - marginPx &&
    y <= rect.bottom + marginPx
  );
}

function main(): void {
  const rootEl = mustElement<HTMLDivElement>('widget-root');
  const canvas = mustElement<HTMLCanvasElement>('tree-canvas');
  const toastEl = mustElement<HTMLDivElement>('milestone-toast');
  const pillEl = mustElement<HTMLDivElement>('hud-pill');
  const speciesDotEl = mustElement<HTMLSpanElement>('hud-species-dot');
  const stageEl = mustElement<HTMLSpanElement>('hud-stage');
  const pausedEl = mustElement<HTMLSpanElement>('hud-paused');
  const countEl = mustElement<HTMLSpanElement>('hud-count');
  const progressFillEl = mustElement<HTMLDivElement>('hud-progress-fill');
  const matureRowEl = mustElement<HTMLDivElement>('hud-mature-row');
  const harvestBtnEl = mustElement<HTMLButtonElement>('hud-harvest-btn');
  const speciesDotsEl = mustElement<HTMLDivElement>('hud-species-dots');
  const forestBtnEl = mustElement<HTMLButtonElement>('hud-forest-btn');

  const api = getGrowTypeAPI();
  const scene = new TreeScene(canvas, {
    scale: 3,
    ambientLife: true,
    background: 'transparent',
  });

  let currentState: AppState | null = null;
  let currentScale = 3;
  let lastTreeSignature = '';
  let lastIgnoreMouse: boolean | null = null;
  let isHovered = false;
  let hoverHideTimer: number | null = null;
  let lastPointerX = -1;
  let lastPointerY = -1;

  const syncSceneTree = (tree: AppState['activeTree']): void => {
    const sig = `${tree.id}:${tree.species}:${tree.seed}:${tree.keystrokes}:${tree.targetKeystrokes}`;
    if (sig === lastTreeSignature) return;
    lastTreeSignature = sig;
    scene.setTree(tree);
  };

  const isCanvasOpaqueAtClient = (clientX: number, clientY: number): boolean => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    if (!isPointInsideRect(clientX, clientY, rect, HIT_RADIUS_PX)) {
      return false;
    }
    return scene.isOpaqueAtCssPoint(clientX - rect.left, clientY - rect.top, HIT_RADIUS_PX);
  };

  const isOverVisibleHud = (clientX: number, clientY: number): boolean => {
    if (!isHovered || currentState?.settings.clickThrough) return false;
    return isPointInsideRect(clientX, clientY, pillEl.getBoundingClientRect(), 4);
  };

  const setIgnoreMouse = (ignore: boolean): void => {
    const effectiveIgnore = currentState?.settings.clickThrough
      ? true
      : drag.isDragging()
        ? false
        : ignore;

    if (effectiveIgnore === lastIgnoreMouse) return;
    lastIgnoreMouse = effectiveIgnore;
    api.setIgnoreMouseEvents(effectiveIgnore);
  };

  const clearHoverTimer = (): void => {
    if (hoverHideTimer !== null) {
      window.clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
  };

  const setHovered = (nextHovered: boolean): void => {
    if (currentState?.settings.clickThrough) {
      clearHoverTimer();
      isHovered = false;
      rootEl.classList.remove('is-hovered');
      return;
    }

    if (nextHovered) {
      clearHoverTimer();
      if (!isHovered) {
        isHovered = true;
        rootEl.classList.add('is-hovered');
      }
      return;
    }

    if (!isHovered || hoverHideTimer !== null) return;
    hoverHideTimer = window.setTimeout(() => {
      hoverHideTimer = null;
      if (drag.isDragging()) return;
      isHovered = false;
      rootEl.classList.remove('is-hovered');
      updatePointerHitTest(lastPointerX, lastPointerY);
    }, HOVER_HIDE_DELAY_MS);
  };

  const updatePointerHitTest = (clientX: number, clientY: number): void => {
    if (currentState?.settings.clickThrough) {
      rootEl.classList.remove('can-drag-tree');
      setHovered(false);
      setIgnoreMouse(true);
      return;
    }

    const overTree = clientX >= 0 && clientY >= 0 && isCanvasOpaqueAtClient(clientX, clientY);
    const overHud = clientX >= 0 && clientY >= 0 && isOverVisibleHud(clientX, clientY);

    rootEl.classList.toggle('can-drag-tree', overTree && !overHud);

    const isInteractive = drag.isDragging() || overTree || overHud;
    setHovered(isInteractive);
    setIgnoreMouse(!isInteractive);
  };

  const drag = createDragController({
    canvas,
    canStartDrag: (clientX, clientY, target) => {
      if (currentState?.settings.clickThrough) return false;
      if (target instanceof Element && target.closest('#hud-pill')) return false;
      if (isOverVisibleHud(clientX, clientY)) return false;
      return isCanvasOpaqueAtClient(clientX, clientY);
    },
    onDragStateChange: () => {
      updatePointerHitTest(lastPointerX, lastPointerY);
    },
    onMove: (x, y) => {
      api.moveWidget(x, y);
    },
    onMoveEnd: (x, y) => {
      api.moveWidgetEnd(x, y);
    },
  });

  const applyState = (nextState: AppState): void => {
    const prevGhost = currentState?.settings.clickThrough ?? false;
    currentState = nextState;

    if (nextState.settings.scale !== currentScale) {
      currentScale = nextState.settings.scale;
      scene.setScale(currentScale);
    }

    rootEl.dataset.scale = String(nextState.settings.scale);
    syncSceneTree(nextState.activeTree);
    hud.updateState(nextState);

    if (nextState.settings.clickThrough) {
      rootEl.classList.remove('can-drag-tree');
      setHovered(false);
      setIgnoreMouse(true);
    } else {
      if (prevGhost !== nextState.settings.clickThrough) {
        lastIgnoreMouse = null;
      }
      if (lastPointerX >= 0 && lastPointerY >= 0) {
        updatePointerHitTest(lastPointerX, lastPointerY);
      }
    }
  };

  const hud = createWidgetHud({
    rootEl,
    pillEl,
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
    onOpenForest: () => {
      void api.openForestWindow();
    },
    onHarvest: async (nextSpecies: SpeciesId) => {
      scene.triggerStageUp('ancient');
      const nextState = await api.harvestAndPlant(nextSpecies);
      applyState(nextState);
    },
    onMilestone: (stage: GrowthStage) => {
      scene.triggerStageUp(stage);
    },
  });

  const handlePointerMove = (event: PointerEvent): void => {
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    updatePointerHitTest(event.clientX, event.clientY);
  };

  const handlePointerLeave = (): void => {
    if (drag.isDragging()) return;
    lastPointerX = -1;
    lastPointerY = -1;
    rootEl.classList.remove('can-drag-tree');
    setHovered(false);
    setIgnoreMouse(true);
  };

  window.addEventListener('pointermove', handlePointerMove);
  document.documentElement.addEventListener('mouseleave', handlePointerLeave);
  window.addEventListener('blur', handlePointerLeave);

  const unsubscribeState = api.onStateUpdated((nextState) => {
    applyState(nextState);
  });

  const unsubscribeTick = api.onKeystrokeTick((payload) => {
    scene.onKeystroke(payload.count);
    if (currentState) {
      const nextKeystrokes = Math.max(currentState.activeTree.keystrokes, payload.treeKeystrokes);
      const updatedTree = {
        ...currentState.activeTree,
        keystrokes: nextKeystrokes,
        targetKeystrokes: payload.targetKeystrokes,
      };
      currentState = {
        ...currentState,
        totalKeystrokes: Math.max(currentState.totalKeystrokes, payload.totalKeystrokes),
        todayKeystrokes: Math.max(currentState.todayKeystrokes, payload.todayKeystrokes),
        activeTree: updatedTree,
      };
      syncSceneTree(updatedTree);
    }
    hud.updateLiveKeystrokes(payload);
  });

  scene.start();
  setIgnoreMouse(true);
  void api.getState().then(applyState);

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('pointermove', handlePointerMove);
    document.documentElement.removeEventListener('mouseleave', handlePointerLeave);
    window.removeEventListener('blur', handlePointerLeave);
    clearHoverTimer();
    unsubscribeState();
    unsubscribeTick();
    drag.destroy();
    hud.destroy();
    scene.destroy();
  });
}

main();
