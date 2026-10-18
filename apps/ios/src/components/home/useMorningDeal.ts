// "The Morning Deal": the first open of the day (from 05:00) Home draws a ring beside "Putting your
// Tuesday together...", then deals the brief's cards onto the page. This hook is the state machine:
//   pending -> (not the first open) done
//   pending -> ring -> deal -> done
// The blocks are hidden only through `pending` and the 550ms ring, never while waiting on the
// network: a daily refresh can take a minute (or hang when the phone drops off), and hiding the brief
// for that long looked like a blank Home. The refresh updates the cards in place afterwards. A hard
// cap (MAX_HIDDEN_MS) deals even if the ring never reports back. The day is stored the moment it is
// evaluated, so a later open the same day is calm. Reduce Motion skips the ring and fades the brief in.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { canvasStore } from '../../canvas/instance';
import { HOME_CANVAS_ID } from '../../canvas/protocol';
import { dealDay, shouldDeal } from '../../lib/morningDeal';
import { kvGet, kvSet } from '../../storage';
import { tapSelection, tapSuccess } from '../chat/haptics';

export type DealPhase = 'pending' | 'ring' | 'deal' | 'done';

const LAST_DEALT_KEY = 'ano.home.lastDealt';
/** Spacing between sections while they are dealt, ms (matches HomeBrief). */
export const DEAL_STAGGER_MS = 55;
/** Longest the brief may stay hidden for the ring, whatever happens to the animation. */
const MAX_HIDDEN_MS = 1500;
const SUCCESS_AFTER_MS = 350;
const SETTLE_MS = 700;
const REDUCED_SETTLE_MS = 250;

export function useMorningDeal({ reduceMotion }: { reduceMotion: boolean }): { phase: DealPhase; ringDrawn: () => void } {
  const [phase, setPhase] = useState<DealPhase>('pending');
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  const evaluate = useCallback(async () => {
    await canvasStore.ready;
    const now = new Date();
    const last = await kvGet(LAST_DEALT_KEY);
    if (!shouldDeal(now, last)) {
      setPhase((current) => (current === 'pending' ? 'done' : current));
      return;
    }
    await kvSet(LAST_DEALT_KEY, dealDay(now));
    const hasBlocks = (canvasStore.get(HOME_CANVAS_ID)?.blocks.length ?? 0) > 0;
    setPhase((current) => {
      if (current !== 'pending' && current !== 'done') return current;
      if (!hasBlocks) return 'done';
      return reduceRef.current ? 'deal' : 'ring';
    });
  }, []);

  useEffect(() => {
    // Any failure reading the day (storage, store) shows the brief instead of leaving it hidden.
    const run = () => evaluate().catch(() => setPhase('done'));
    void run();
    // Left open overnight: the first foreground of a new day deals again.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => subscription.remove();
  }, [evaluate]);

  // The ring is decoration: deal when it is drawn, or after MAX_HIDDEN_MS no matter what.
  useEffect(() => {
    if (phase !== 'ring') return;
    const timer = setTimeout(() => setPhase((current) => (current === 'ring' ? 'deal' : current)), MAX_HIDDEN_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'deal') return;
    const cancels: Array<() => void> = [];
    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      cancels.push(() => clearTimeout(timer));
    };
    if (reduceRef.current) {
      void tapSelection();
      later(() => setPhase('done'), REDUCED_SETTLE_MS);
    } else {
      const cards = canvasStore.get(HOME_CANVAS_ID)?.blocks.length ?? 0;
      for (let i = 0; i < Math.min(3, cards); i += 1) later(() => void tapSelection(), i * DEAL_STAGGER_MS);
      later(() => void tapSuccess(), SUCCESS_AFTER_MS);
      later(() => setPhase('done'), cards * DEAL_STAGGER_MS + SETTLE_MS);
    }
    return () => cancels.forEach((cancel) => cancel());
  }, [phase]);

  const ringDrawn = useCallback(() => setPhase((current) => (current === 'ring' ? 'deal' : current)), []);
  return { phase, ringDrawn };
}
