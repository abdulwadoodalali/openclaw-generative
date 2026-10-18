// The touch-and-hold menu of a canvas tile, shared by Home and the Canvases list: Refresh now, Lock
// or Unlock, Set up agent, Pin, Rename and Delete. `element` holds the sheets and the toast a
// refresh shows; render it once at the end of the screen.
import React, { useCallback, useState } from 'react';
import { canvasStore } from '../canvas/instance';
import { canvasRunners } from '../canvas/runner';
import type { Canvas } from '../canvas/types';
import { CanvasAgentSheet } from '../components/CanvasAgentSheet';
import { CanvasActionsSheet } from '../components/CanvasSheets';
import { RefreshToast } from '../components/RefreshToast';
import { useCanvases } from './useCanvases';

export function useCanvasMenu({ toastBottom }: { toastBottom: number }) {
  const all = useCanvases();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [toastId, setToastId] = useState<string | null>(null);

  const menuCanvas = menuId ? all.find((c) => c.id === menuId) ?? null : null;
  const agentCanvas = agentId ? all.find((c) => c.id === agentId) ?? null : null;

  const refresh = useCallback((c: Canvas) => {
    setToastId(c.id);
    void canvasRunners.get(c.id).refresh();
  }, []);

  const element = (
    <>
      <CanvasActionsSheet
        canvas={menuCanvas}
        onClose={() => setMenuId(null)}
        onRefresh={refresh}
        onToggleLock={(c) => canvasStore.setLocked(c.id, !c.locked)}
        onSetupAgent={(c) => setAgentId(c.id)}
        onTogglePin={(c) => canvasStore.setPinned(c.id, !c.pinned)}
        onRename={(c, title) => canvasStore.rename(c.id, title)}
        onDelete={(c) => canvasStore.remove(c.id)}
      />
      <CanvasAgentSheet canvas={agentCanvas} onClose={() => setAgentId(null)} />
      {toastId ? <RefreshToast key={toastId} canvasId={toastId} bottom={toastBottom} /> : null}
    </>
  );

  return { openMenu: setMenuId, element };
}
