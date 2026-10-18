// "Needs you" as a small deck: the top card in full, the next two peeking 6 pt and 12 pt below at
// 0.96 and 0.92. Swipe right does it (the card's prompt goes to a new chat), left snoozes it until
// tonight, up hands it to its agent in the background. Crossing a threshold ticks (selection
// haptic), committing lands (success). Under Reduce Motion the card does not fly off: it fades and
// the next one fades in. Every swipe is also a visible button and an accessibility action, so
// swiping is never required. Answer cards show a chip per option instead of the pill.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BriefCard } from '../../genui/components/BriefItem';
import type { HomeCard } from '../../home/cards';
import { snoozeUntil } from '../../home/triage';
import { formatClock } from '../../home/verdict';
import { usePagerGesture } from '../../lib/pagerGesture';
import { colors, fonts, type } from '../../theme';
import { tapSelection, tapSuccess } from '../chat/haptics';

const VISIBLE = 3;
const PEEK = 6;
const SCALES = [1, 0.96, 0.92];
const SWIPE = 96;
const FLING = 700;
const FLY_MS = 220;
const FADE_MS = 200;
const SPRING = { damping: 20, stiffness: 240, mass: 0.8 };

/** 0 none, 1 do (right), 2 snooze (left), 3 hand off (up). */
type Intent = 0 | 1 | 2 | 3;

/** Which way a drag of (x, y) with velocity (vx, vy) commits; flings count from a third of the distance. */
function intentOf(x: number, y: number, vx: number, vy: number): Intent {
  'worklet';
  if ((-y > SWIPE || (vy < -FLING && -y > SWIPE / 3)) && -y > Math.abs(x)) return 3;
  if (x > SWIPE || (vx > FLING && x > SWIPE / 3)) return 1;
  if (x < -SWIPE || (vx < -FLING && x < -SWIPE / 3)) return 2;
  return 0;
}

export type TriageDeckProps = {
  cards: readonly HomeCard[];
  agentName: (id: string) => string;
  reduceMotion: boolean;
  /** The Home scroll view's gesture: it waits for a swipe that starts on the deck to fail. */
  scrollGesture: GestureType;
  onDo: (card: HomeCard) => void;
  onSnooze: (card: HomeCard) => void;
  onHandOff: (card: HomeCard) => void;
  onAnswer: (card: HomeCard, option: string) => void;
  onOpen: (card: HomeCard) => void;
};

export function TriageDeck({ cards, ...rest }: TriageDeckProps) {
  const [frontHeight, setFrontHeight] = useState(0);
  const visible = cards.slice(0, VISIBLE);
  const more = cards.length - visible.length;
  if (visible.length === 0) return null;
  return (
    <View>
      <View style={{ paddingBottom: PEEK * (visible.length - 1) }}>
        {visible
          .map((card, depth) => (
            <DeckCard key={card.id} card={card} depth={depth} frontHeight={frontHeight} onFrontHeight={setFrontHeight} {...rest} />
          ))
          .reverse()}
      </View>
      {more > 0 ? <Text style={styles.more}>{`+${more} more`}</Text> : null}
    </View>
  );
}

type DeckCardProps = Omit<TriageDeckProps, 'cards'> & {
  card: HomeCard;
  depth: number;
  frontHeight: number;
  onFrontHeight: (height: number) => void;
};

function DeckCard(props: DeckCardProps) {
  const { card, depth, frontHeight, onFrontHeight, agentName, reduceMotion, scrollGesture, onDo, onSnooze, onHandOff, onAnswer, onOpen } = props;
  const { width, height } = useWindowDimensions();
  const front = depth === 0;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const armed = useSharedValue<Intent>(0);
  const fade = useSharedValue(1);
  const place = useSharedValue(depth);
  const committing = useRef(false);
  const previousDepth = useRef(depth);

  // Moving up the deck: a spring to the new place, or (Reduce Motion) a fade in at it.
  useEffect(() => {
    const from = previousDepth.current;
    previousDepth.current = depth;
    if (from === depth) return;
    if (reduceMotion) {
      place.value = depth;
      if (depth === 0) {
        fade.value = 0;
        fade.value = withTiming(1, { duration: FADE_MS, reduceMotion: ReduceMotion.Never });
      }
    } else {
      place.value = withSpring(depth, SPRING);
    }
  }, [depth, reduceMotion, place, fade]);

  const until = new Date(snoozeUntil(new Date()));
  const snoozeLabel = `Snooze until ${formatClock(until.getHours() * 60 + until.getMinutes())}`;

  const commit = useCallback(
    (intent: Intent) => {
      void tapSuccess();
      if (intent === 1) onDo(card);
      else if (intent === 2) onSnooze(card);
      else if (intent === 3) onHandOff(card);
    },
    [card, onDo, onSnooze, onHandOff],
  );

  /** Takes the card off the deck in the direction of `intent`, then commits it. Runs on either thread. */
  const leave = useCallback(
    (intent: Intent) => {
      'worklet';
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(commit)(intent);
      };
      if (reduceMotion) fade.value = withTiming(0, { duration: FADE_MS, reduceMotion: ReduceMotion.Never }, done);
      else if (intent === 3) ty.value = withTiming(-height, { duration: FLY_MS }, done);
      else tx.value = withTiming(intent === 1 ? width + 80 : -(width + 80), { duration: FLY_MS }, done);
    },
    [reduceMotion, height, width, commit, fade, tx, ty],
  );

  const press = useCallback(
    (intent: Intent) => {
      if (committing.current) return;
      committing.current = true;
      leave(intent);
    },
    [leave],
  );

  const pagerGesture = usePagerGesture();
  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .enabled(front)
      .activeOffsetX([-12, 12])
      .activeOffsetY(-12)
      .failOffsetY(14)
      .onUpdate((e) => {
        tx.value = e.translationX;
        ty.value = Math.min(0, e.translationY);
        const next = intentOf(e.translationX, e.translationY, 0, 0);
        if (next !== armed.value) {
          armed.value = next;
          if (next !== 0) runOnJS(tapSelection)();
        }
      })
      .onEnd((e) => {
        const intent = intentOf(e.translationX, Math.min(0, e.translationY), e.velocityX, e.velocityY);
        armed.value = 0;
        if (intent !== 0) {
          leave(intent);
          return;
        }
        tx.value = withSpring(0, SPRING);
        ty.value = withSpring(0, SPRING);
      });
    // Home's vertical scroll and the Home | Chat pager both wait for this pan to fail, so a sideways
    // swipe on the deck moves the card, not the page.
    return pagerGesture ? gesture.blocksExternalGesture(scrollGesture, pagerGesture) : gesture.blocksExternalGesture(scrollGesture);
  }, [front, scrollGesture, pagerGesture, leave, tx, ty, armed]);

  const cardStyle = useAnimatedStyle(() => {
    const scale = interpolate(place.value, [0, 1, 2], SCALES, Extrapolation.CLAMP);
    const tilt = reduceMotion ? 0 : interpolate(tx.value, [-width, width], [-8, 8], Extrapolation.CLAMP);
    return {
      opacity: fade.value,
      transform: [
        { translateX: tx.value },
        // Scaled about its centre, so the bottom edge is lifted by half the shrink: put it back, then peek.
        { translateY: ty.value + place.value * PEEK + frontHeight * (1 - scale) * 0.5 },
        { scale },
        { rotate: `${tilt}deg` },
      ],
    };
  });
  const doHint = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, SWIPE], [0, 1], Extrapolation.CLAMP) }));
  const snoozeHint = useAnimatedStyle(() => ({ opacity: interpolate(-tx.value, [0, SWIPE], [0, 1], Extrapolation.CLAMP) }));
  const handHint = useAnimatedStyle(() => ({
    opacity: -ty.value > Math.abs(tx.value) ? interpolate(-ty.value, [0, SWIPE], [0, 1], Extrapolation.CLAMP) : 0,
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    if (front) onFrontHeight(e.nativeEvent.layout.height);
  };

  const actions = [
    ...(card.action ? [{ name: 'do', label: card.action.label }] : []),
    { name: 'snooze', label: snoozeLabel },
    { name: 'handoff', label: 'Hand off' },
  ];

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={onLayout}
        pointerEvents={front ? 'auto' : 'none'}
        accessibilityElementsHidden={!front}
        importantForAccessibility={front ? 'auto' : 'no-hide-descendants'}
        style={[front ? styles.front : [styles.back, frontHeight > 0 && { height: frontHeight }], cardStyle]}
      >
        <BriefCard
          card={card}
          agentName={card.agent ? agentName(card.agent) : null}
          raised
          style={front ? null : styles.clip}
          onOpen={() => onOpen(card)}
          onAct={() => press(1)}
          onOption={(option) => {
            if (committing.current) return;
            void tapSelection();
            onAnswer(card, option);
          }}
          accessibilityActions={actions}
          onAccessibilityAction={(name) => press(name === 'do' ? 1 : name === 'snooze' ? 2 : 3)}
          secondary={
            <>
              <QuietButton label="Snooze" accessibilityLabel={snoozeLabel} onPress={() => press(2)} />
              <QuietButton label="Hand off" accessibilityLabel="Hand off to the agent" onPress={() => press(3)} />
            </>
          }
        />
        {front ? (
          <View pointerEvents="none" style={styles.hints}>
            <Animated.Text style={[styles.hint, styles.hintDo, doHint]}>Do it</Animated.Text>
            <Animated.Text style={[styles.hint, styles.hintSnooze, snoozeHint]}>{snoozeLabel}</Animated.Text>
            <Animated.Text style={[styles.hint, styles.hintHand, handHint]}>Hand off</Animated.Text>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

function QuietButton({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
    >
      <Text style={styles.quietLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  front: { zIndex: 1 },
  back: { position: 'absolute', top: 0, left: 0, right: 0 },
  clip: { flex: 1, overflow: 'hidden' },
  more: { ...type.label, marginTop: 10, color: colors.inkSecondary, fontVariant: ['tabular-nums'] },
  hints: { position: 'absolute', top: 12, left: 12, right: 12, alignItems: 'center' },
  hint: {
    position: 'absolute',
    top: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.white,
  },
  hintDo: { left: 0, backgroundColor: colors.accent },
  hintSnooze: { right: 0, backgroundColor: colors.toast },
  hintHand: { backgroundColor: colors.household },
  quiet: { height: 36, paddingHorizontal: 10, justifyContent: 'center' },
  quietPressed: { opacity: 0.6 },
  quietLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.inkSecondary },
});
