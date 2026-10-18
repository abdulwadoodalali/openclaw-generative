// The Home card contract: BriefItem props read into one shape (old cards included), the rule that
// drops a vague card instead of showing it, and the Home layout (which card goes in which section,
// in what order). Pure TypeScript.
import type { CanvasBlock } from '../canvas/types.ts';
import { isPlainObject } from '../canvas/types.ts';

export const CARD_KINDS = ['decide', 'answer', 'headsUp', 'moving', 'handled', 'today', 'tomorrow'] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export type CardTone = 'accent' | 'household' | 'default';
export type CardAction = { label: string; prompt: string };
/** One agenda entry of a `today` card; `minutes` counts from local midnight. */
export type AgendaEvent = { minutes: number; title: string };

export type HomeCard = {
  /** Stable across refreshes (snooze and hand-off are stored by it). Derived from the title when the agent gave none. */
  id: string;
  kind: CardKind;
  /** The claim. */
  title: string;
  /** Why now (old cards: `detail`). */
  why: string | null;
  stake: string | null;
  agent: string | null;
  source: string | null;
  action: CardAction | null;
  /** Answer cards only: the choices, 2 to 4. */
  options: string[];
  tone: CardTone;
  /** When the fact was seen or the action happened (ms), or null. */
  at: number | null;
  /** `today` cards only, sorted by time. */
  events: AgendaEvent[];
};

export const MAX_WHY = 100;
export const MAX_STAKE = 12;
export const MAX_OPTIONS = 4;
const MAX_EVENTS = 12;

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clip(value: string | null, max: number, ellipsis: boolean): string | null {
  if (value === null || value.length <= max) return value;
  return ellipsis ? `${value.slice(0, max - 3).trimEnd()}...` : value.slice(0, max).trimEnd();
}

/** FNV-1a of the text, hex. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A clock time as minutes from midnight: "14:00", "9:05", "2:00 pm", "2pm", or an ISO date-time
 * (its local time). Null when it is none of those.
 */
export function parseClock(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const clock = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m?\.?$/i.exec(raw) ?? /^(\d{1,2})[:.](\d{2})$/.exec(raw);
  if (clock) {
    let hours = Number(clock[1]);
    const minutes = clock[2] ? Number(clock[2]) : 0;
    const half = clock[3]?.toLowerCase();
    if (minutes > 59) return null;
    if (half) {
      if (hours < 1 || hours > 12) return null;
      hours = (hours % 12) + (half === 'p' ? 12 : 0);
    } else if (hours > 23) {
      return null;
    }
    return hours * 60 + minutes;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return null;
    const date = new Date(at);
    return date.getHours() * 60 + date.getMinutes();
  }
  return null;
}

function readAction(value: unknown): CardAction | null {
  if (!isPlainObject(value)) return null;
  const label = text(value.label);
  const prompt = text(value.prompt);
  return label && prompt ? { label, prompt } : null;
}

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const option = text(item);
    if (option && !out.includes(option)) out.push(option);
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

function readEvents(value: unknown): AgendaEvent[] {
  if (!Array.isArray(value)) return [];
  const out: AgendaEvent[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const minutes = parseClock(item.time ?? item.at);
    const title = text(item.title);
    if (minutes !== null && title) out.push({ minutes, title });
    if (out.length === MAX_EVENTS) break;
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

function readKind(value: unknown, title: string): CardKind {
  if (typeof value === 'string' && (CARD_KINDS as readonly string[]).includes(value)) return value as CardKind;
  // Before kinds, the evening card was a BriefItem titled "Tomorrow: ...".
  return /^tomorrow\b/i.test(title) ? 'tomorrow' : 'headsUp';
}

/**
 * A BriefItem's props as a card, or null without a title. Old cards stay readable: `detail` is the
 * why, no `kind` reads as headsUp (or tomorrow for a "Tomorrow: ..." title), `tone` is the scope dot.
 */
export function readCard(props: Record<string, unknown>): HomeCard | null {
  const title = text(props.title);
  if (!title) return null;
  const kind = readKind(props.kind, title);
  const at = typeof props.at === 'string' ? Date.parse(props.at) : NaN;
  return {
    id: text(props.id) ?? `t-${hash(title)}`,
    kind,
    title,
    why: clip(text(props.why) ?? text(props.detail), MAX_WHY, true),
    stake: clip(text(props.stake), MAX_STAKE, false),
    agent: text(props.agent),
    source: text(props.source),
    action: readAction(props.action),
    options: kind === 'answer' ? readOptions(props.options) : [],
    tone: props.tone === 'household' || props.tone === 'default' ? props.tone : 'accent',
    at: Number.isFinite(at) ? at : null,
    events: kind === 'today' ? readEvents(props.events) : [],
  };
}

/** Why a card is not shown, or null when it is fine. Decide, answer and heads-up cards need a why and an action. */
export function cardProblem(card: HomeCard): string | null {
  if (card.kind === 'decide' || card.kind === 'answer' || card.kind === 'headsUp') {
    if (!card.why) return 'no why';
    if (!card.action) return 'no action';
  }
  if (card.kind === 'today' && card.events.length === 0) return 'no events';
  return null;
}

/** A readable name for an agent id the gateway has not listed (yet): "finance" reads "Finance". */
export function agentLabel(id: string): string {
  const words = id.replace(/^ano-/, '').split(/[-_\s]+/).filter(Boolean).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

export type OtherBlock = { block: CanvasBlock; index: number };

export type HomeLayout = {
  /** decide and answer cards in the agent's order (most urgent first), minus the ones `hidden` says to hide. */
  needs: HomeCard[];
  headsUp: HomeCard[];
  /** The first today card (null without one) and its events still to come. */
  today: { card: HomeCard; upcoming: AgendaEvent[] } | null;
  handled: HomeCard[];
  /** One at most. */
  moving: HomeCard | null;
  /** Only in the evening. */
  tomorrow: HomeCard | null;
  /** Every other catalog block in order; a Heading is kept only when the next block is another catalog block. */
  other: OtherBlock[];
};

export type LayoutOptions = {
  now: Date;
  /** From this local hour the tomorrow card shows. */
  eveningHour: number;
  /** True for a needs-you card the user snoozed, did or handed off. */
  hidden?: (id: string) => boolean;
};

/**
 * Sorts the Home blocks into sections. A card that fails its rule (cardProblem) is dropped, the
 * second card with an id already seen is dropped, and Heading blocks from before Home grouped by
 * kind ("Needs you" above BriefItems) are dropped.
 */
export function homeLayout(blocks: readonly CanvasBlock[], { now, eveningHour, hidden }: LayoutOptions): HomeLayout {
  const layout: HomeLayout = { needs: [], headsUp: [], today: null, handled: [], moving: null, tomorrow: null, other: [] };
  const seen = new Set<string>();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  blocks.forEach((block, index) => {
    if (block.component === 'Heading') {
      const next = blocks[index + 1];
      if (next && next.component !== 'BriefItem' && next.component !== 'Heading') layout.other.push({ block, index });
      return;
    }
    if (block.component !== 'BriefItem') {
      layout.other.push({ block, index });
      return;
    }
    const card = readCard(block.props);
    if (!card || cardProblem(card) || seen.has(card.id)) return;
    seen.add(card.id);
    switch (card.kind) {
      case 'decide':
      case 'answer':
        if (!hidden?.(card.id)) layout.needs.push(card);
        break;
      case 'headsUp':
        layout.headsUp.push(card);
        break;
      case 'handled':
        layout.handled.push(card);
        break;
      case 'moving':
        layout.moving ??= card;
        break;
      case 'today':
        layout.today ??= { card, upcoming: card.events.filter((e) => e.minutes >= nowMinutes) };
        break;
      case 'tomorrow':
        if (now.getHours() >= eveningHour) layout.tomorrow ??= card;
        break;
    }
  });
  return layout;
}

/** Ids of the cards still waiting on you (every kind but handled): a hand-off is in progress while its card is one of them. */
export function waitingIds(blocks: readonly CanvasBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.component !== 'BriefItem') continue;
    const card = readCard(block.props);
    if (card && card.kind !== 'handled') ids.add(card.id);
  }
  return ids;
}
