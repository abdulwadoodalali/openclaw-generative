// Drives the undo toast of a canvas: it appears for a change Ano just made (the editor's
// `lastChange`) or one the app made itself (`notify`), hides after a few seconds, and Undo calls
// canvasStore.undo, which restores the previous version as a new version.
import { useCallback, useEffect, useState } from 'react';
import { canvasStore } from '../canvas/instance';

export const UNDO_TOAST_MS = 5000;

type Change = { summary: string; version: number };

export function useUndoToast(canvasId: string, lastChange: Change | null) {
  const [toast, setToast] = useState<Change | null>(null);

  const changeVersion = lastChange?.version;
  const changeSummary = lastChange?.summary;
  useEffect(() => {
    if (changeVersion === undefined || changeSummary === undefined) return;
    setToast({ summary: changeSummary, version: changeVersion });
  }, [changeVersion, changeSummary]);

  const toastVersion = toast?.version;
  useEffect(() => {
    if (toastVersion === undefined) return;
    const timer = setTimeout(() => setToast(null), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toastVersion, toast?.summary]);

  /** Shows the toast for a change the app made itself (the canvas is already at `version`). */
  const notify = useCallback((summary: string) => {
    const canvas = canvasStore.get(canvasId);
    if (canvas) setToast({ summary, version: canvas.version });
  }, [canvasId]);

  const undo = useCallback(() => {
    canvasStore.undo(canvasId);
    setToast(null);
  }, [canvasId]);

  return { toast, notify, undo, dismiss: () => setToast(null) };
}
