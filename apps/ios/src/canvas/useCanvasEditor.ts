// The React face of a canvas runner (src/canvas/runner.ts): the run state of one canvas plus the
// actions that start and stop turns. The runner lives outside React, so a run keeps going when the
// screen unmounts and every screen showing the canvas sees the same state.
import { useMemo, useSyncExternalStore } from 'react';
import { canvasRunners, type CanvasRunState } from './runner';

export type CanvasEditor = CanvasRunState & {
  /** One "edit by asking" turn in the canvas's own session (an error while the canvas is locked). */
  send(text: string): Promise<void>;
  /** A [ui-event] from a component inside the canvas: the same kind of turn (unlocked canvases only). */
  sendUiEvent(text: string): Promise<void>;
  /** Re-read the canvas's data. Locked canvases keep their layout. */
  refresh(): Promise<void>;
  stop(): void;
  clearError(): void;
};

export function useCanvasEditor(canvasId: string): CanvasEditor {
  const runner = canvasRunners.get(canvasId);
  const state = useSyncExternalStore(canvasRunners.subscribe, () => runner.getState(), () => runner.getState());
  const actions = useMemo(
    () => ({
      send: (text: string) => runner.send(text),
      sendUiEvent: (text: string) => runner.sendUiEvent(text),
      refresh: () => runner.refresh(),
      stop: () => runner.stop(),
      clearError: () => runner.clearError(),
    }),
    [runner],
  );
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
