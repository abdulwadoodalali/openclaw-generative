// The "Needs you" triage state on the phone (src/home/triage.ts), persisted to `ano/homeTriage.json`
// (localStorage on web) and shared by every screen through useSyncExternalStore. Swiping left
// snoozes a card, right marks it done (you took it to chat), up hands it off: the hand-off waits here
// until Home's runner is free, then goes out as one background turn (see handOffPrompt).
import { useSyncExternalStore } from 'react';
import { createJsonFileStorage } from '../../genui/registryStorage';
import type { HomeCard } from '../../home/cards';
import { doneUntil, parseTriage, pruneTriage, snoozeUntil, type HandOff, type TriageState } from '../../home/triage';
import { userRef } from '../../env';

const storage = createJsonFileStorage('homeTriage.json', 'ano.home.triage');
const listeners = new Set<() => void>();
let state: TriageState = {};
let loaded = false;

function set(next: TriageState): void {
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener();
  storage.save(JSON.stringify(state)).catch(() => undefined);
}

/** Changes made before the file was read are kept on top of what it held. */
const ready = storage.load().then((json) => {
  const changes = state;
  state = { ...pruneTriage(parseTriage(json), Date.now()), ...changes };
  loaded = true;
  for (const listener of [...listeners]) listener();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const triage = {
  ready,
  get: (): TriageState => state,
  snooze(id: string): void {
    set({ ...state, [id]: { state: 'snoozed', until: snoozeUntil(new Date()) } });
  },
  done(id: string): void {
    set({ ...state, [id]: { state: 'done', until: doneUntil(new Date()) } });
  },
  /** Hands the card to its agent (with the option you picked on an answer card). */
  handOff(card: HomeCard, answer: string | null = null): void {
    const entry: HandOff = {
      state: 'handing',
      since: Date.now(),
      sent: false,
      title: card.title,
      agent: card.agent,
      prompt: card.action?.prompt ?? null,
      answer,
    };
    set({ ...state, [card.id]: entry });
  },
  /** Drops what ran out; with `waiting` (ids of cards still waiting on you) also finished hand-offs. Only once loaded. */
  prune(waiting?: ReadonlySet<string>): void {
    if (loaded) set(pruneTriage(state, Date.now(), waiting));
  },
  update(change: (current: TriageState) => TriageState): void {
    set(change(state));
  },
};

export function useTriage(): TriageState {
  return useSyncExternalStore(subscribe, triage.get, triage.get);
}

/** The background turn that sends hand-offs to their agents through Home's runner. `userName` defaults to EXPO_PUBLIC_ANO_USER_NAME. */
export function handOffPrompt(items: ReadonlyArray<{ id: string; handOff: HandOff }>, userName?: string | null): string {
  const user = userRef(userName);
  const lines = items.map(({ id, handOff }) => {
    const who = handOff.agent ? `agent "${handOff.agent}"` : 'the right agent';
    const what = handOff.answer
      ? `${user} answered "${handOff.answer}" to "${handOff.title}". Carry on with that answer.`
      : `"${handOff.title}". ${handOff.prompt ?? 'Do what the card asks.'}`;
    return `- Card id "${id}", for ${who}: ${what}`;
  });
  return [
    `Handle it: ${user} handed these Home cards to their agents. Have each agent do it and report back. When one is done, replace its card (keep the same id) with a "handled" card saying what was done, with "at" set to now. If one cannot be finished, keep it as a decide or answer card with a new "why" saying what is missing.`,
    ...lines,
  ].join('\n');
}
