// The orb's state machine (design-v5 "Orb", research §6.3). Pure: (state, event, now) -> state, so
// the store (orbStore.ts) owns time and timers and this file runs under node:test.
//
// Precedence of the visual state: offline > error > a run (thinking / working / streaming) > done >
// listening > idle. Error holds until the next user action (focus, keystroke, send) or a new run;
// done falls back to idle (or listening) DONE_HOLD_MS after it started.
import type { RunMode } from '../openclaw/OpenClawAgent.ts';

export type OrbVisualState = 'idle' | 'listening' | 'thinking' | 'working' | 'streaming' | 'done' | 'error' | 'offline';

export type OrbEvent =
  | { type: 'focus' | 'blur' | 'keystroke' | 'send' }
  | { type: 'run'; mode: RunMode | null }
  | { type: 'token' }
  | { type: 'toolStart' }
  | { type: 'toolEnd' }
  | { type: 'handoff'; tone?: string }
  | { type: 'done'; ms: number }
  | { type: 'error' }
  | { type: 'connection'; online: boolean };

/** What the reducer takes: the public events plus the store's timer tick (a timed transition is due). */
export type OrbInput = OrbEvent | { type: 'tick' };

/** One-shot motion cues: the orb animates them, they do not change the visual state. */
export type OrbPulse = 'keystroke' | 'token' | 'ring' | 'send' | 'reconnect';

/** Done shows for this long (exhale ~420 ms, ring 300 + 200 ms), then idle. */
export const DONE_HOLD_MS = 900;
/** Listening relaxes after this long without typing. */
export const RELAX_AFTER_MS = 1500;
/** Thinking (and working between events) slows down after this long. */
export const SLOW_AFTER_MS = 10_000;
/** Streaming with no token for this long falls back to half-amplitude thinking motion. */
export const QUIET_AFTER_MS = 1200;
/** At most one keystroke impulse per this many ms. */
export const KEYSTROKE_THROTTLE_MS = 110;
/** At most one token impulse per this many ms (about one per frame batch of the stream). */
export const TOKEN_THROTTLE_MS = 90;
/** Done is followed by a soft haptic only when the run took at least this long. */
export const DONE_HAPTIC_MIN_MS = 8000;

export type OrbState = {
  online: boolean;
  focused: boolean;
  /** A run or the gateway failed; held until the next user action. */
  error: boolean;
  /** The chat run's mode, null when no run is going. */
  run: RunMode | null;
  runStartedAt: number | null;
  /** Tool calls that started and have not ended (the satellite shows while > 0). */
  tools: number;
  /** Tone of the agent a handoff went to ('accent' | 'household'), null for Ano's own tools. */
  tone: string | null;
  /** Last focus or keystroke, for the listening relax timer. */
  typedAt: number | null;
  lastTokenAt: number | null;
  doneAt: number | null;
  /** How long the last finished run took. */
  doneMs: number;
  lastKeyPulseAt: number | null;
  lastTokenPulseAt: number | null;
  /** The latest motion cue and a counter that changes with every cue. */
  pulse: OrbPulse | null;
  pulseSeq: number;
  // Derived (recomputed on every event):
  visual: OrbVisualState;
  /** Listening, but no typing for RELAX_AFTER_MS. */
  relaxed: boolean;
  /** Thinking or working for SLOW_AFTER_MS. */
  slow: boolean;
  /** Streaming, but no token for QUIET_AFTER_MS. */
  quiet: boolean;
};

export const INITIAL_ORB: OrbState = {
  online: false,
  focused: false,
  error: false,
  run: null,
  runStartedAt: null,
  tools: 0,
  tone: null,
  typedAt: null,
  lastTokenAt: null,
  doneAt: null,
  doneMs: 0,
  lastKeyPulseAt: null,
  lastTokenPulseAt: null,
  pulse: null,
  pulseSeq: 0,
  visual: 'offline',
  relaxed: false,
  slow: false,
  quiet: false,
};

/** The visual state for a run mode; canvas orbs use it for runs that are not the chat's. */
export function visualForMode(run: RunMode): OrbVisualState {
  if (run === 'answering') return 'streaming';
  if (run === 'working') return 'working';
  return 'thinking';
}

/** Expire done and recompute the derived fields for `now`. */
function settle(s: OrbState, now: number): OrbState {
  const doneAt = s.doneAt !== null && now - s.doneAt >= DONE_HOLD_MS ? null : s.doneAt;
  const visual: OrbVisualState = !s.online
    ? 'offline'
    : s.error
      ? 'error'
      : s.run !== null
        ? visualForMode(s.run)
        : doneAt !== null
          ? 'done'
          : s.focused
            ? 'listening'
            : 'idle';
  return {
    ...s,
    doneAt,
    visual,
    relaxed: visual === 'listening' && s.typedAt !== null && now - s.typedAt >= RELAX_AFTER_MS,
    slow: (visual === 'thinking' || visual === 'working') && s.runStartedAt !== null && now - s.runStartedAt >= SLOW_AFTER_MS,
    quiet: visual === 'streaming' && s.lastTokenAt !== null && now - s.lastTokenAt >= QUIET_AFTER_MS,
  };
}

function withPulse(s: OrbState, pulse: OrbPulse): OrbState {
  return { ...s, pulse, pulseSeq: s.pulseSeq + 1 };
}

const ENDED = { run: null, runStartedAt: null, tools: 0, tone: null, lastTokenAt: null } as const;

export function reduceOrb(s: OrbState, event: OrbInput, now: number): OrbState {
  return settle(apply(s, event, now), now);
}

function apply(s: OrbState, e: OrbInput, now: number): OrbState {
  switch (e.type) {
    case 'tick':
      return s;
    case 'connection':
      if (e.online === s.online) return s;
      return e.online ? withPulse({ ...s, online: true }, 'reconnect') : { ...s, online: false };
    case 'focus':
      return { ...s, focused: true, error: false, typedAt: now };
    case 'blur':
      return { ...s, focused: false, typedAt: null };
    case 'keystroke': {
      const next = { ...s, focused: true, error: false, typedAt: now };
      if (s.lastKeyPulseAt !== null && now - s.lastKeyPulseAt < KEYSTROKE_THROTTLE_MS) return next;
      return withPulse({ ...next, lastKeyPulseAt: now }, 'keystroke');
    }
    case 'send':
      return withPulse({ ...s, error: false, doneAt: null, typedAt: now }, 'send');
    case 'run': {
      if (e.mode === null) return { ...s, ...ENDED };
      const fresh = s.run === null;
      const base = fresh ? { ...s, ...ENDED, error: false, doneAt: null, runStartedAt: now } : s;
      const lastTokenAt = e.mode === 'answering' ? (base.lastTokenAt ?? now) : base.lastTokenAt;
      return { ...base, run: e.mode, lastTokenAt };
    }
    case 'token': {
      if (s.run === null) return s;
      const next = { ...s, run: 'answering' as const, lastTokenAt: now };
      if (s.lastTokenPulseAt !== null && now - s.lastTokenPulseAt < TOKEN_THROTTLE_MS) return next;
      return withPulse({ ...next, lastTokenPulseAt: now }, 'token');
    }
    case 'toolStart':
      if (s.run === null) return s;
      return withPulse({ ...s, run: 'working', tools: s.tools + 1 }, 'ring');
    case 'toolEnd':
      return { ...s, tools: Math.max(0, s.tools - 1) };
    case 'handoff':
      if (s.run === null) return s;
      return withPulse({ ...s, run: 'working', tone: e.tone ?? s.tone }, 'ring');
    case 'done':
      return { ...s, ...ENDED, doneAt: now, doneMs: e.ms };
    case 'error':
      return { ...s, ...ENDED, error: true, doneAt: null };
  }
}

/** When the next timed transition is due, or null when nothing is pending. */
export function nextDeadline(s: OrbState): number | null {
  const due: number[] = [];
  if (s.doneAt !== null) due.push(s.doneAt + DONE_HOLD_MS);
  if (s.visual === 'listening' && !s.relaxed && s.typedAt !== null) due.push(s.typedAt + RELAX_AFTER_MS);
  if ((s.visual === 'thinking' || s.visual === 'working') && !s.slow && s.runStartedAt !== null) due.push(s.runStartedAt + SLOW_AFTER_MS);
  if (s.visual === 'streaming' && !s.quiet && s.lastTokenAt !== null) due.push(s.lastTokenAt + QUIET_AFTER_MS);
  return due.length > 0 ? Math.min(...due) : null;
}

/** The haptic a transition earns: soft on a slow run's done, warning on an error. */
export function hapticFor(prev: OrbState, next: OrbState): 'soft' | 'warning' | null {
  if (next.visual === prev.visual) return null;
  if (next.visual === 'done' && next.doneMs >= DONE_HAPTIC_MIN_MS) return 'soft';
  if (next.visual === 'error') return 'warning';
  return null;
}

/** What an orb renders: the visual state plus the modifiers that change its motion. */
export type OrbView = {
  visual: OrbVisualState;
  relaxed: boolean;
  slow: boolean;
  quiet: boolean;
  /** A tool call is running (the satellite). */
  tool: boolean;
  tone: string | null;
};

export function viewOf(s: OrbState): OrbView {
  return { visual: s.visual, relaxed: s.relaxed, slow: s.slow, quiet: s.quiet, tool: s.visual === 'working' && s.tools > 0, tone: s.tone };
}

export function sameView(a: OrbView, b: OrbView): boolean {
  return a.visual === b.visual && a.relaxed === b.relaxed && a.slow === b.slow && a.quiet === b.quiet && a.tool === b.tool && a.tone === b.tone;
}
