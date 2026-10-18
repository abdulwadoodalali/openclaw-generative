// Subscribes a component to the canvas store and returns the current canvases (stable array
// reference until something changes).
import { useSyncExternalStore } from 'react';
import { canvasStore } from '../canvas/instance';
import type { Canvas } from '../canvas/types';

const subscribe = (listener: () => void) => canvasStore.subscribe(listener);
const getSnapshot = () => canvasStore.getSnapshot();

export function useCanvases(): readonly Canvas[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** One canvas by id, undefined when it does not exist (yet, or any more). */
export function useCanvas(id: string | undefined): Canvas | undefined {
  const all = useCanvases();
  return id === undefined ? undefined : all.find((c) => c.id === id);
}
