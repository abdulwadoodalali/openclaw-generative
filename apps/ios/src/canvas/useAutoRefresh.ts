// Refreshes the canvases in `ids` that are stale under their refresh policy (src/canvas/refresh.ts):
// when the screen is focused and the gateway is ready, and again whenever the app returns to the
// foreground. Refreshes run one at a time app-wide. A refresh that was already tried (successfully or
// not) is not retried within two minutes, so a failing canvas cannot loop. Refreshes that started keep
// going when the screen goes away.
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAno } from '../state/AnoProvider';
import { canvasStore } from './instance';
import { isStale } from './refresh.ts';
import { canvasRunners } from './runner';

const RETRY_AFTER_MS = 2 * 60 * 1000;

const lastAttempt = new Map<string, number>();
/** Serializes every pump: at most one automatic refresh at a time. */
let queue: Promise<void> = Promise.resolve();

async function refreshStale(ids: readonly string[], cancelled: () => boolean): Promise<void> {
  await canvasStore.ready;
  for (const id of ids) {
    if (cancelled()) return;
    const canvas = canvasStore.get(id);
    if (!canvas) continue;
    const now = Date.now();
    if (!isStale(canvas, now)) continue;
    const attempted = lastAttempt.get(id);
    if (attempted !== undefined && now - attempted < RETRY_AFTER_MS) continue;
    const runner = canvasRunners.get(id);
    if (runner.getState().running) continue;
    lastAttempt.set(id, now);
    await runner.refresh();
  }
}

/**
 * @param enabled Extra gate for screens that are mounted but not visible (for example a pager page).
 */
export function useAutoRefresh(ids: readonly string[], enabled = true): void {
  const { connection } = useAno();
  const focused = useIsFocused();
  const ready = connection.status === 'ready';
  const [foregrounded, setForegrounded] = useState(0);
  const key = ids.join('\n');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setForegrounded((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !focused || !ready || key === '') return;
    let cancelled = false;
    const wanted = key.split('\n');
    queue = queue.then(() => refreshStale(wanted, () => cancelled)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, focused, ready, connection.readyCount, key, foregrounded]);
}
