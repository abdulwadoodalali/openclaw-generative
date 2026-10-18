// When a canvas is due for a refresh, per its agent.refresh policy. Pure TypeScript; `now` is injected.
import type { Canvas } from './types.ts';

/** 'open' canvases refresh whenever they are shown, unless they were refreshed this recently. */
export const OPEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;
export const HOURLY_REFRESH_MS = 60 * 60 * 1000;
/** The local hour after which a 'daily' canvas counts as a new day. */
export const DAILY_REFRESH_HOUR = 6;

/** Today's 06:00 in local time, as epoch milliseconds. */
function dailyBoundary(now: number): number {
  const boundary = new Date(now);
  boundary.setHours(DAILY_REFRESH_HOUR, 0, 0, 0);
  return boundary.getTime();
}

/**
 * - manual: never stale.
 * - open: stale unless refreshed within the last 2 minutes.
 * - hourly: stale when the last refresh is older than 1 hour.
 * - daily: stale once it is 06:00 local or later and the last refresh was before today's 06:00.
 * A canvas that was never refreshed counts as refreshed at time 0.
 */
export function isStale(canvas: Pick<Canvas, 'agent' | 'lastRefreshedAt'>, now: number): boolean {
  const last = canvas.lastRefreshedAt ?? 0;
  switch (canvas.agent.refresh) {
    case 'open':
      return now - last >= OPEN_REFRESH_WINDOW_MS;
    case 'hourly':
      return now - last > HOURLY_REFRESH_MS;
    case 'daily': {
      const boundary = dailyBoundary(now);
      return now >= boundary && last < boundary;
    }
    default:
      return false;
  }
}
