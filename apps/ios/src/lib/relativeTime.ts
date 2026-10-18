// Short relative timestamps for canvas versions: "just now", "2 min ago", "3 h ago", "yesterday",
// "4 days ago", then a plain date. Pure TypeScript.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const diff = Math.max(0, now - at);
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A canvas counts as old on Home when it was last updated this long ago. */
export const OLD_AFTER_MS = 4 * HOUR;

/** "Updated 6:02" for something from today, otherwise "Updated yesterday", "Updated 4 days ago", "Updated Oct 3". */
export function updatedStamp(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return 'Not updated yet';
  const then = new Date(at);
  const today = new Date(now);
  if (then.toDateString() === today.toDateString()) {
    return `Updated ${then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })}`;
  }
  return `Updated ${relativeTime(at, now)}`;
}

/** "v6 · Ano, 2 min ago" or "v2 · You, yesterday". */
export function versionLabel(version: number, by: 'ano' | 'you', at: number, now: number = Date.now()): string {
  return `v${version} · ${by === 'ano' ? 'Ano' : 'You'}, ${relativeTime(at, now)}`;
}
