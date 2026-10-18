// The one orb store every orb reads (Home masthead, chat header, activity rows). Signals come from
// the composer (focus, blur, keystroke, send), the chat agent (run, token, tool, handoff, done,
// error) and the gateway connection. The pure reducer is orbMachine.ts; this file owns the clock,
// the timer for timed transitions, haptics, and fan-out of motion pulses to mounted orbs.
import { useSyncExternalStore } from 'react';
import * as Haptics from 'expo-haptics';
import { INITIAL_ORB, hapticFor, nextDeadline, reduceOrb, sameView, viewOf, type OrbEvent, type OrbInput, type OrbPulse, type OrbView } from './orbMachine.ts';

let state = INITIAL_ORB;
let view: OrbView = viewOf(state);
let timer: ReturnType<typeof setTimeout> | undefined;
const viewListeners = new Set<() => void>();
const pulseListeners = new Set<(pulse: OrbPulse) => void>();

function dispatch(event: OrbInput): void {
  const prev = state;
  state = reduceOrb(prev, event, Date.now());

  const haptic = hapticFor(prev, state);
  if (haptic === 'soft') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined);
  if (haptic === 'warning') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);

  clearTimeout(timer);
  const due = nextDeadline(state);
  timer = due === null ? undefined : setTimeout(() => dispatch({ type: 'tick' }), Math.max(0, due - Date.now()));

  if (state.pulse !== null && state.pulseSeq !== prev.pulseSeq) {
    const pulse = state.pulse;
    pulseListeners.forEach((listener) => listener(pulse));
  }
  const nextView = viewOf(state);
  if (!sameView(view, nextView)) {
    view = nextView;
    viewListeners.forEach((listener) => listener());
  }
}

/** Tell the orb what just happened. Cheap; call it from event handlers as often as events come. */
export function orbSignal(event: OrbEvent): void {
  dispatch(event);
}

function subscribeView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

const getView = (): OrbView => view;

/** The orb's derived state; re-renders only when the visual state or one of its modifiers changes. */
export function useOrbState(): OrbView {
  return useSyncExternalStore(subscribeView, getView, getView);
}

/** One-shot motion cues (keystroke, token, ring, send, reconnect), delivered without a re-render. */
export function subscribeOrbPulse(listener: (pulse: OrbPulse) => void): () => void {
  pulseListeners.add(listener);
  return () => pulseListeners.delete(listener);
}
