// What you did with the "Needs you" cards, kept on the phone by card id: snoozed until tonight,
// done (you took it to chat), or handed off to the card's agent (shown under Handled as in progress
// until the agent reports back by turning the card into a handled one). Pure TypeScript; the
// persisted store is src/components/home/useTriage.ts.
import { EVENING_HOUR } from '../canvas/protocol.ts';
import { isPlainObject } from '../canvas/types.ts';

/** A snooze made in the evening comes back at this hour the next morning. */
export const MORNING_HOUR = 8;
/** A card you took to chat stays out of the deck until this hour the next day (the deal day starts at 05:00). */
const DAY_START_HOUR = 5;
/** A hand-off nobody reported back on stops showing as in progress after this long. */
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

export type HandOff = {
  state: 'handing';
  since: number;
  /** False until the hand-off turn has been sent (it waits while Home is busy or offline). */
  sent: boolean;
  title: string;
  agent: string | null;
  /** What to do: the card's action prompt. */
  prompt: string | null;
  /** Answer cards: the option you picked. */
  answer: string | null;
};

export type TriageEntry = { state: 'snoozed' | 'done'; until: number } | HandOff;
export type TriageState = Readonly<Record<string, TriageEntry>>;

/** Tonight at 18:00, or tomorrow at 08:00 once it is 18:00 or later. */
export function snoozeUntil(now: Date): number {
  const until = new Date(now);
  if (now.getHours() >= EVENING_HOUR) {
    until.setDate(until.getDate() + 1);
    until.setHours(MORNING_HOUR, 0, 0, 0);
  } else {
    until.setHours(EVENING_HOUR, 0, 0, 0);
  }
  return until.getTime();
}

/** The next 05:00. */
export function doneUntil(now: Date): number {
  const until = new Date(now);
  if (now.getHours() >= DAY_START_HOUR) until.setDate(until.getDate() + 1);
  until.setHours(DAY_START_HOUR, 0, 0, 0);
  return until.getTime();
}

/** True while the card stays out of the deck. */
export function isHidden(entry: TriageEntry | undefined, now: number): boolean {
  if (!entry) return false;
  return entry.state === 'handing' || now < entry.until;
}

function readEntry(raw: unknown): TriageEntry | null {
  if (!isPlainObject(raw)) return null;
  if ((raw.state === 'snoozed' || raw.state === 'done') && typeof raw.until === 'number') return { state: raw.state, until: raw.until };
  if (raw.state !== 'handing' || typeof raw.since !== 'number' || typeof raw.title !== 'string') return null;
  const optional = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    state: 'handing',
    since: raw.since,
    sent: raw.sent === true,
    title: raw.title,
    agent: optional(raw.agent),
    prompt: optional(raw.prompt),
    answer: optional(raw.answer),
  };
}

/** The stored JSON read back; anything unreadable is left out. */
export function parseTriage(json: string | null): TriageState {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isPlainObject(raw)) return {};
  const state: Record<string, TriageEntry> = {};
  for (const [id, value] of Object.entries(raw)) {
    const entry = readEntry(value);
    if (entry) state[id] = entry;
  }
  return state;
}

/**
 * Drops snoozes and dones that ran out, hand-offs older than HANDOFF_TTL_MS and, when `waiting` is
 * given (the ids of the cards still waiting on you), hand-offs whose card was answered or removed.
 * Returns `state` itself when nothing changed.
 */
export function pruneTriage(state: TriageState, now: number, waiting?: ReadonlySet<string>): TriageState {
  let changed = false;
  const next: Record<string, TriageEntry> = {};
  for (const [id, entry] of Object.entries(state)) {
    const keep =
      entry.state === 'handing' ? now - entry.since < HANDOFF_TTL_MS && (!waiting || waiting.has(id)) : now < entry.until;
    if (keep) next[id] = entry;
    else changed = true;
  }
  return changed ? next : state;
}

/** Without the entries of `ids`. */
export function withoutEntries(state: TriageState, ids: readonly string[]): TriageState {
  const next = { ...state };
  for (const id of ids) delete next[id];
  return next;
}

/** Hand-offs not sent yet, oldest first. */
export function unsentHandOffs(state: TriageState): Array<{ id: string; handOff: HandOff }> {
  const out: Array<{ id: string; handOff: HandOff }> = [];
  for (const [id, entry] of Object.entries(state)) if (entry.state === 'handing' && !entry.sent) out.push({ id, handOff: entry });
  return out.sort((a, b) => a.handOff.since - b.handOff.since);
}

/** The hand-offs of `ids` marked as sent. */
export function markSent(state: TriageState, ids: readonly string[]): TriageState {
  const next = { ...state };
  for (const id of ids) {
    const entry = next[id];
    if (entry?.state === 'handing') next[id] = { ...entry, sent: true };
  }
  return next;
}
