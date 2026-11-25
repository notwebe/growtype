export interface DragControllerOptions {
  canvas: HTMLCanvasElement;
  canStartDrag: (clientX: number, clientY: number, target: EventTarget | null) => boolean;
  onDragStateChange: (dragging: boolean) => void;
  onMove: (x: number, y: number) => void;
  onMoveEnd: (x: number, y: number) => void;
}

export interface DragController {
  isDragging(): boolean;
  destroy(): void;
}

const DRAG_THRESHOLD_PX = 3;

export function createDragController(options: DragControllerOptions): DragController {
  const { canvas, canStartDrag, onDragStateChange, onMove, onMoveEnd } = options;

  let activePointerId: number | null = null;
  let startScreenX = 0;
  let startScreenY = 0;
  let startWinX = 0;
  let startWinY = 0;
  let thresholdPassed = false;
  let lastSentX = 0;
  let lastSentY = 0;

  const isDragging = (): boolean => activePointerId !== null;

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || activePointerId !== null) return;
    if (!canStartDrag(event.clientX, event.clientY, event.target)) return;

    activePointerId = event.pointerId;
    startScreenX = event.screenX;
    startScreenY = event.screenY;
    startWinX = window.screenX;
    startWinY = window.screenY;
    thresholdPassed = false;
    lastSentX = Math.round(startWinX);
    lastSentY = Math.round(startWinY);

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events may not support capture.
    }

    onDragStateChange(true);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;

    const dx = event.screenX - startScreenX;
    const dy = event.screenY - startScreenY;

    if (!thresholdPassed) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      thresholdPassed = true;
      document.body.classList.add('is-dragging');
    }

    const nextX = Math.round(startWinX + dx);
    const nextY = Math.round(startWinY + dy);
    if (nextX !== lastSentX || nextY !== lastSentY) {
      lastSentX = nextX;
      lastSentY = nextY;
      onMove(nextX, nextY);
    }
  };

  const finishDrag = (
    pointerId: number,
    commit: boolean,
    screenX?: number,
    screenY?: number,
  ): void => {
    if (pointerId !== activePointerId) return;

    const moved = thresholdPassed;
    const endX =
      screenX !== undefined ? Math.round(startWinX + (screenX - startScreenX)) : lastSentX;
    const endY =
      screenY !== undefined ? Math.round(startWinY + (screenY - startScreenY)) : lastSentY;

    activePointerId = null;
    thresholdPassed = false;
    document.body.classList.remove('is-dragging');

    try {
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore if capture was already released.
    }

    onDragStateChange(false);

    if (commit && moved) {
      onMoveEnd(endX, endY);
    }
  };

  const handlePointerUp = (event: PointerEvent): void => {
    finishDrag(event.pointerId, true, event.screenX, event.screenY);
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    finishDrag(event.pointerId, false);
  };

  const handleLostPointerCapture = (event: PointerEvent): void => {
    finishDrag(event.pointerId, true);
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);
  canvas.addEventListener('lostpointercapture', handleLostPointerCapture);

  return {
    isDragging,
    destroy(): void {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture);
      document.body.classList.remove('is-dragging');
      activePointerId = null;
    },
  };
}
