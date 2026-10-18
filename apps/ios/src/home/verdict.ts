// The verdict line beside the orb on Home: one sentence built from counts, never from model prose.
// "2 things need you · 5 handled" / "Nothing needs you. Clear until 2:00 pm." / "All quiet. I'll keep watch."
// Pure TypeScript.
import type { AgendaEvent } from './cards.ts';

export type VerdictInput = {
  /** Cards left in the Needs you deck. */
  needs: number;
  /** Handled receipts (not counting hand-offs still in progress). */
  handled: number;
  headsUp: number;
  inProgress: number;
  /** The Today card's events still to come, or null when Home has no Today card. */
  upcoming: readonly AgendaEvent[] | null;
};

/** "2:00 pm", "9:05 am", "12:30 pm" for minutes from midnight. */
export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(mins).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}

export function verdictLine({ needs, handled, headsUp, inProgress, upcoming }: VerdictInput): string {
  const handledPart = handled > 0 ? ` · ${handled} handled` : '';
  if (needs > 0) return `${needs} ${needs === 1 ? 'thing needs' : 'things need'} you${handledPart}`;
  if (upcoming) {
    const next = upcoming[0];
    return next ? `Nothing needs you. Clear until ${formatClock(next.minutes)}.` : 'Nothing needs you. Clear for the rest of today.';
  }
  if (handled > 0) return `Nothing needs you${handledPart}`;
  if (headsUp > 0 || inProgress > 0) return 'Nothing needs you.';
  return "All quiet. I'll keep watch.";
}
