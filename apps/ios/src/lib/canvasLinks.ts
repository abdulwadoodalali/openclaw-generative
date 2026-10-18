// Remembers which canvas was made from which chat object (an assistant message id for "Pin as
// canvas", a tool call id for a canvas_update create) so the same message never pins twice and the
// chat can show "Pinned · Open" again after a restart. Persisted to `ano/canvasLinks.json`.
import { useSyncExternalStore } from 'react';
import { createJsonFileStorage } from '../genui/registryStorage';

const MAX_LINKS = 200;

const storage = createJsonFileStorage('canvasLinks.json', 'ano.canvas.links');
let links = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

const ready: Promise<void> = storage.load().then((json) => {
  if (!json) return;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return;
    // Anything linked before the file loaded wins over the stored value.
    const merged = new Map<string, string>(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
    for (const [k, v] of links) merged.set(k, v);
    links = merged;
    emit();
  } catch {
    // A corrupt file is the same as none.
  }
});

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function persist(): void {
  void ready.then(() => storage.save(JSON.stringify(Object.fromEntries(links))).catch(() => undefined));
}

export function getLinkedCanvasId(key: string): string | undefined {
  return links.get(key);
}

export function linkCanvas(key: string, canvasId: string): void {
  links.delete(key);
  links.set(key, canvasId);
  while (links.size > MAX_LINKS) {
    const oldest = links.keys().next();
    if (oldest.done) break;
    links.delete(oldest.value);
  }
  emit();
  persist();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** The canvas linked to `key`, re-read when links change. */
export function useLinkedCanvasId(key: string): string | undefined {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return links.get(key);
}
