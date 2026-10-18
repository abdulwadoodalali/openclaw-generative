// Sidebar grouping: pinned chats first, then the rest by day (Today, Yesterday, Earlier), newest first.
import type { Thread } from '../../openclaw/sessionsApi';

export type ThreadGroup = { title: string; threads: Thread[] };

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function groupByDay(threads: readonly Thread[], now: number = Date.now()): ThreadGroup[] {
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  const today = startOfDay(now);
  const buckets: Record<'Pinned' | 'Today' | 'Yesterday' | 'Earlier', Thread[]> = { Pinned: [], Today: [], Yesterday: [], Earlier: [] };
  for (const thread of sorted) {
    if (thread.pinned) buckets.Pinned.push(thread);
    else if (thread.updatedAt >= today) buckets.Today.push(thread);
    else if (thread.updatedAt >= today - DAY_MS) buckets.Yesterday.push(thread);
    else buckets.Earlier.push(thread);
  }
  const order = ['Pinned', 'Today', 'Yesterday', 'Earlier'] as const;
  return order.filter((title) => buckets[title].length > 0).map((title) => ({ title, threads: buckets[title] }));
}

/** "6:02 PM" for today, otherwise "Yesterday", "Oct 3". */
export function rowTime(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const today = startOfDay(now);
  if (at >= today) return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (at >= today - DAY_MS) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
