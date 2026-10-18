// The Ano orb (design-v5 "Orb", research §6.3). A glass sphere on one SVG, driven by the global orb
// store (src/orb/orbStore.ts): still when idle with an occasional glance, leaning in while you
// type, orbiting while Ano thinks, ringing for tools, pulsing with streamed tokens, exhaling on done,
// shaking on error, grey when offline. Every motion is a Reanimated shared value on the UI thread;
// colour changes cross-fade between two gradient slots. Canvas runs that are not the chat's pass an
// explicit `state` instead and get no event pulses.
//
// Reduce Motion: no translate, rotate or scale. Opacity, glow and colour still animate (with
// ReduceMotion.Never, or Reanimated would skip them) and haptics come from the store.
import React, { useEffect, useId, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, RadialGradient, Stop } from 'react-native-svg';
import type { OrbView, OrbVisualState } from '../orb/orbMachine.ts';
import { subscribeOrbPulse, useOrbState } from '../orb/orbStore';
import { useTilt } from '../orb/useTilt';
import { colors, orbColors } from '../theme';
import { useReduceMotion } from './chat/useReduceMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Stops = readonly [string, string, string];

/** `a` blended toward `b` by `t`, both "#RRGGBB" tokens. */
function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Listening: idle, 30% of the way toward thinking. */
const listeningStop = (i: 0 | 1 | 2) => mixHex(orbColors.idle[i], orbColors.thinking[i], 0.3);
const LISTENING: Stops = [listeningStop(0), listeningStop(1), listeningStop(2)];

function stopsFor(visual: OrbVisualState, tone: string | null): Stops {
  switch (visual) {
    case 'listening':
      return LISTENING;
    case 'thinking':
      return orbColors.thinking;
    case 'working':
      return tone === 'accent' ? orbColors.thinking : orbColors.working;
    case 'streaming':
      return orbColors.streaming;
    case 'error':
      return orbColors.error;
    case 'offline':
      return orbColors.offline;
    default:
      // idle, and done (the colour returns to idle while the ring draws)
      return orbColors.idle;
  }
}

/** Cross-fade length into a state: error is quick, done settles slowly, a handoff tone in between. */
function fadeMsFor(visual: OrbVisualState): number {
  if (visual === 'error') return 150;
  if (visual === 'done') return 600;
  if (visual === 'working') return 400;
  return 240;
}

type Slots = { a: Stops; b: Stops; front: 'a' | 'b'; fadeMs: number };

const NEVER = ReduceMotion.Never;
const SIN = Easing.inOut(Easing.sin);
const OUT = Easing.out(Easing.cubic);
const THINK_MS = 2800;
const THINK_SLOW_MS = 4200;
const BREATH_HALF_MS = 1100;
const IMPULSE_CAP = 0.08;

export type AnoOrbProps = {
  /** Diameter of the sphere in points; glow and rings draw outside it without taking layout space. */
  size?: number;
  /** For runs that are not the chat's (a canvas refresh): show this state, ignore the global store. */
  state?: OrbVisualState;
};

export function AnoOrb({ size = 28, state }: AnoOrbProps) {
  // Never name this `global`: Reanimated worklets reach `global.Error` and would get the orb state.
  const fromStore = useOrbState();
  const view: OrbView = state === undefined ? fromStore : { visual: state, relaxed: false, slow: false, quiet: false, tool: false, tone: null };
  const live = state === undefined;
  const reduceNow = useReduceMotion();
  const reducedAtStart = useReducedMotion();
  const rm = reduceNow || reducedAtStart;
  const tilt = useTilt(!rm);
  // SVG ids are document-global on web: keep them unique per orb.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const R = size / 2;
  const box = size * 2;
  const c = box / 2;
  const tiltScale = Math.min(1, size / 32);

  const lean = useSharedValue(1);
  const squeeze = useSharedValue(1);
  const impulse = useSharedValue(0);
  const breath = useSharedValue(0);
  const breathAmp = useSharedValue(0);
  const orbit = useSharedValue(0);
  const orbitAmp = useSharedValue(0);
  const glanceX = useSharedValue(0);
  const glanceS = useSharedValue(0);
  const leanY = useSharedValue(0);
  const shake = useSharedValue(0);
  const alpha = useSharedValue(0.92);
  const glow = useSharedValue(0.3);
  const lift = useSharedValue(0);
  const mix = useSharedValue(0);
  const ring = useSharedValue(0);
  const ringAlpha = useSharedValue(0);
  const doneDraw = useSharedValue(0);
  const doneAlpha = useSharedValue(0);
  const sat = useSharedValue(0);
  const satScale = useSharedValue(0);
  const orbitMs = useRef(0);
  const breathing = useRef(false);

  // Colour: two gradient slots; the new look goes into the hidden one, then `mix` cross-fades.
  const target = stopsFor(view.visual, view.tone);
  const [slots, setSlots] = useState<Slots>({ a: target, b: target, front: 'a', fadeMs: 0 });
  const shown = slots.front === 'a' ? slots.a : slots.b;
  if (shown !== target) {
    const fadeMs = fadeMsFor(view.visual);
    setSlots(slots.front === 'a' ? { a: slots.a, b: target, front: 'b', fadeMs } : { a: target, b: slots.b, front: 'a', fadeMs });
  }
  useEffect(() => {
    mix.value = withTiming(slots.front === 'b' ? 1 : 0, { duration: slots.fadeMs, reduceMotion: NEVER });
  }, [slots, mix]);

  // State changes: set where every value should rest or loop for this state.
  useEffect(() => {
    const v = view.visual;
    const thinkingish = v === 'thinking' || v === 'working' || (v === 'streaming' && view.quiet);
    const half = v === 'streaming' ? 0.5 : 1;

    cancelAnimation(alpha);
    if (rm && thinkingish) {
      alpha.value = withSequence(
        NEVER,
        withTiming(1, { duration: 150, reduceMotion: NEVER }),
        withRepeat(withTiming(0.75, { duration: 1600, easing: SIN, reduceMotion: NEVER }), -1, true, undefined, NEVER),
      );
    } else if (v === 'done') {
      alpha.value = rm
        ? withSequence(NEVER, withTiming(0.7, { duration: 100, reduceMotion: NEVER }), withTiming(0.92, { duration: 100, reduceMotion: NEVER }))
        : withTiming(0.92, { duration: 600, reduceMotion: NEVER });
    } else if (v === 'error' && rm) {
      const flash = (to: number) => withTiming(to, { duration: 80, reduceMotion: NEVER });
      alpha.value = withSequence(NEVER, flash(0.55), flash(1), flash(0.55), flash(1));
    } else {
      alpha.value = withTiming(v === 'offline' ? 0.5 : v === 'idle' ? 0.92 : 1, { duration: v === 'listening' ? 150 : 240, reduceMotion: NEVER });
    }
    glow.value = withTiming(v === 'offline' ? 0.1 : v === 'idle' || v === 'listening' || v === 'done' ? 0.3 : 0.5, { duration: 240, reduceMotion: NEVER });

    if (v === 'done') {
      doneDraw.value = rm ? 1 : withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 300, easing: OUT }));
      doneAlpha.value = withSequence(
        NEVER,
        withTiming(1, { duration: rm ? 150 : 0, reduceMotion: NEVER }),
        withDelay(rm ? 150 : 300, withTiming(0, { duration: 200, reduceMotion: NEVER }), NEVER),
      );
    }

    if (rm) {
      // Hold every transform at rest.
      for (const sv of [orbit, breath, impulse, glanceX, glanceS, shake, squeeze, lean, leanY, orbitAmp, breathAmp]) cancelAnimation(sv);
      orbitMs.current = 0;
      breathing.current = false;
      lean.value = 1;
      squeeze.value = 1;
      impulse.value = 0;
      leanY.value = 0;
      orbitAmp.value = 0;
      breathAmp.value = 0;
      glanceX.value = 0;
      glanceS.value = 0;
      shake.value = 0;
      return;
    }

    if (v === 'listening') {
      lean.value = view.relaxed ? withTiming(1.03, { duration: 400 }) : withSpring(1.06, { damping: 18, stiffness: 260 });
      leanY.value = withSpring(size * 0.1, { damping: 18, stiffness: 260 });
    } else {
      lean.value = withTiming(1, { duration: 300 });
      leanY.value = withTiming(0, { duration: 300 });
    }

    breathAmp.value = withTiming(thinkingish ? half : 0, { duration: 300 });
    orbitAmp.value = withTiming(thinkingish ? R * 0.22 * half : 0, { duration: 300 });
    if (thinkingish) {
      const ms = view.slow ? THINK_SLOW_MS : THINK_MS;
      if (orbitMs.current !== ms) {
        orbitMs.current = ms;
        const from = orbit.value % 1;
        orbit.value = from;
        orbit.value = withRepeat(withTiming(from + 1, { duration: ms, easing: Easing.linear }), -1);
      }
      if (!breathing.current) {
        breathing.current = true;
        breath.value = withSequence(withTiming(0, { duration: 300 }), withRepeat(withTiming(1, { duration: BREATH_HALF_MS, easing: SIN }), -1, true));
      }
    } else {
      cancelAnimation(orbit);
      cancelAnimation(breath);
      orbitMs.current = 0;
      breathing.current = false;
    }

    if (v === 'done') {
      squeeze.value = withSequence(withTiming(1.12, { duration: 160, easing: OUT }), withSpring(1, { damping: 12, stiffness: 220 }));
    }
    if (v === 'error') {
      const amp = Math.min(1, size / 28);
      const step = (to: number) => withTiming(to * amp, { duration: 64 });
      shake.value = withSequence(step(-3), step(3), step(-2), step(2), step(0));
    }
  }, [view.visual, view.relaxed, view.slow, view.quiet, rm, size, R, alpha, glow, doneDraw, doneAlpha, orbit, breath, impulse, glanceX, glanceS, shake, squeeze, lean, leanY, orbitAmp, breathAmp]);

  // The satellite: orbits while a tool call runs, absorbed when it ends. None under Reduce Motion.
  useEffect(() => {
    if (view.tool && !rm) {
      satScale.value = withTiming(1, { duration: 180 });
      sat.value = withRepeat(withTiming(sat.value + 1, { duration: 1200, easing: Easing.linear }), -1);
    } else {
      satScale.value = withTiming(0, { duration: rm ? 0 : 180 }, (finished) => {
        if (finished) cancelAnimation(sat);
      });
    }
  }, [view.tool, rm, sat, satScale]);

  // Idle glance: every 7-12 s (random, so it never settles into a rhythm) the highlight looks aside.
  useEffect(() => {
    if (rm || view.visual !== 'idle') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(
        () => {
          const dir = Math.random() < 0.5 ? -1 : 1;
          glanceX.value = withSequence(withTiming(dir * size * 0.08, { duration: 700, easing: SIN }), withTiming(0, { duration: 700, easing: SIN }));
          glanceS.value = withSequence(withTiming(0.025, { duration: 700, easing: SIN }), withTiming(0, { duration: 700, easing: SIN }));
          schedule();
        },
        7000 + Math.random() * 5000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [rm, view.visual, size, glanceX, glanceS]);

  // Event pulses from the store: springs and one-shot fades, never loops.
  useEffect(() => {
    if (!live) return;
    const kick = (amount: number, damping: number, stiffness: number) => {
      impulse.value = withSequence(withTiming(Math.min(IMPULSE_CAP, impulse.value + amount), { duration: 40 }), withSpring(0, { damping, stiffness }));
    };
    return subscribeOrbPulse((pulse) => {
      switch (pulse) {
        case 'keystroke':
          if (!rm) kick(0.02, 14, 400);
          return;
        case 'token':
          lift.value = withSequence(NEVER, withTiming(0.1, { duration: 60, reduceMotion: NEVER }), withTiming(0, { duration: 320, reduceMotion: NEVER }));
          if (!rm) kick(0.012, 20, 320);
          return;
        case 'ring':
          if (rm) {
            ring.value = 0.36;
            ringAlpha.value = withSequence(NEVER, withTiming(0.35, { duration: 60, reduceMotion: NEVER }), withTiming(0, { duration: 140, reduceMotion: NEVER }));
          } else {
            ring.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 650, easing: OUT }));
            ringAlpha.value = withSequence(withTiming(0.35, { duration: 0 }), withTiming(0, { duration: 650, easing: OUT }));
          }
          return;
        case 'send':
          if (!rm) squeeze.value = withSequence(withTiming(0.9, { duration: 120 }), withSpring(1, { damping: 14, stiffness: 260 }));
          return;
        case 'reconnect':
          if (!rm) squeeze.value = withSequence(withTiming(1.06, { duration: 160, easing: OUT }), withSpring(1, { damping: 12, stiffness: 220 }));
          return;
      }
    });
  }, [live, rm, impulse, lift, ring, ringAlpha, squeeze]);

  const sphereStyle = useAnimatedStyle(() => {
    const breathe = 1 + breathAmp.value * (breath.value - 0.5) * 0.06;
    return {
      opacity: alpha.value,
      transform: [{ translateX: shake.value }, { scale: lean.value * squeeze.value * breathe * (1 + impulse.value + glanceS.value) }],
    };
  });
  const glowLevel = () => {
    'worklet';
    return Math.min(1, glow.value + lift.value + breathAmp.value * (breath.value - 0.5) * 0.3);
  };
  const glowA = useAnimatedProps(() => ({ opacity: glowLevel() * (1 - mix.value) }));
  const glowB = useAnimatedProps(() => ({ opacity: glowLevel() * mix.value }));
  const bodyB = useAnimatedProps(() => ({ opacity: mix.value }));
  const highlight = useAnimatedProps(() => {
    const angle = orbit.value * 2 * Math.PI;
    return {
      cx: c - R * 0.3 + orbitAmp.value * Math.cos(angle) + glanceX.value + tilt.x.value * tiltScale,
      cy: c - R * 0.34 + orbitAmp.value * Math.sin(angle) + leanY.value + tilt.y.value * tiltScale,
      opacity: 0.8 + lift.value * 2,
    };
  });
  const toolRing = useAnimatedProps(() => ({ r: R * (1 + 0.7 * ring.value), strokeOpacity: ringAlpha.value }));
  const doneR = R * 1.22;
  const doneLength = 2 * Math.PI * doneR;
  const doneRing = useAnimatedProps(() => ({ strokeDashoffset: doneLength * (1 - doneDraw.value), strokeOpacity: doneAlpha.value }));
  const satR = Math.max(1, size * 0.05);
  const satellite = useAnimatedProps(() => {
    const angle = sat.value * 2 * Math.PI - Math.PI / 2;
    return { cx: c + R * 1.32 * Math.cos(angle), cy: c + R * 1.32 * Math.sin(angle), r: satR * satScale.value };
  });

  const slot = (key: 'a' | 'b', stops: Stops) => (
    <React.Fragment key={key}>
      <RadialGradient id={`glow${key}${id}`} cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={stops[1]} stopOpacity={0.6} />
        <Stop offset="0.62" stopColor={stops[1]} stopOpacity={0.45} />
        <Stop offset="1" stopColor={stops[1]} stopOpacity={0} />
      </RadialGradient>
      <RadialGradient id={`body${key}${id}`} cx="38%" cy="32%" r="72%">
        <Stop offset="0" stopColor={stops[0]} />
        <Stop offset="0.55" stopColor={stops[1]} />
        <Stop offset="1" stopColor={stops[2]} />
      </RadialGradient>
    </React.Fragment>
  );
  const notch = view.visual === 'error';

  return (
    <View style={{ width: size, height: size }} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.canvas, { width: box, height: box, left: -size / 2, top: -size / 2 }, sphereStyle]}>
        <Svg width={box} height={box}>
          <Defs>
            {slot('a', slots.a)}
            {slot('b', slots.b)}
            <RadialGradient id={`hl${id}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.white} stopOpacity={0.9} />
              <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
            </RadialGradient>
            <ClipPath id={`clip${id}`}>
              <Circle cx={c} cy={c} r={R} />
            </ClipPath>
          </Defs>
          <AnimatedCircle cx={c} cy={c} r={R * 1.5} fill={`url(#glowa${id})`} animatedProps={glowA} />
          <AnimatedCircle cx={c} cy={c} r={R * 1.5} fill={`url(#glowb${id})`} animatedProps={glowB} />
          <Circle cx={c} cy={c} r={R} fill={`url(#bodya${id})`} />
          <AnimatedCircle cx={c} cy={c} r={R} fill={`url(#bodyb${id})`} animatedProps={bodyB} />
          <G clipPath={`url(#clip${id})`}>
            <AnimatedCircle r={R * 0.55} fill={`url(#hl${id})`} animatedProps={highlight} />
          </G>
          <AnimatedCircle cx={c} cy={c} fill="none" stroke={target[1]} strokeWidth={Math.max(1, size * 0.04)} animatedProps={toolRing} />
          <AnimatedCircle
            cx={c}
            cy={c}
            r={doneR}
            fill="none"
            stroke={colors.signal}
            strokeWidth={Math.max(1, size * 0.05)}
            strokeLinecap="round"
            strokeDasharray={`${doneLength} ${doneLength}`}
            rotation={-90}
            origin={`${c}, ${c}`}
            animatedProps={doneRing}
          />
          <AnimatedCircle fill={target[2]} animatedProps={satellite} />
          {notch ? (
            <Circle
              cx={c + R * 0.71}
              cy={c - R * 0.71}
              r={Math.max(1.5, size * 0.11)}
              fill={colors.danger}
              stroke={colors.white}
              strokeWidth={Math.max(1, size * 0.04)}
              opacity={0.85}
            />
          ) : null}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute' },
});
