// Under the greeting while Home is dealt: a 28pt face with a 1.5pt ring that draws itself clockwise
// (550ms, cubic out) beside "Putting your Tuesday together...". When the ring is drawn the screen
// decides when the cards are dealt (it waits for a running refresh), so the ring stays complete.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../../theme';
import { AgentFace } from '../chat/AgentFace';

const SIZE = 28;
const STROKE = 1.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const DRAW_MS = 550;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type MorningDealHeaderProps = {
  weekday: string;
  /** The agent whose face draws the ring (the default agent for new chats). */
  agentId: string;
  initial: string;
  onRingDrawn: () => void;
};

export function MorningDealHeader({ weekday, agentId, initial, onRingDrawn }: MorningDealHeaderProps) {
  const offset = useRef(new Animated.Value(CIRCUMFERENCE)).current;

  useEffect(() => {
    const draw = Animated.timing(offset, {
      toValue: 0,
      duration: DRAW_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    draw.start(({ finished }) => {
      if (finished) onRingDrawn();
    });
    return () => draw.stop();
  }, [offset, onRingDrawn]);

  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={`Putting your ${weekday} together`}>
      <View style={styles.faceBox}>
        <AgentFace agentId={agentId} initial={initial} size={SIZE} breathing />
        <Svg width={SIZE} height={SIZE} style={styles.ring}>
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={colors.accent}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={[CIRCUMFERENCE, CIRCUMFERENCE]}
            strokeDashoffset={offset}
            rotation={-90}
            origin={`${SIZE / 2}, ${SIZE / 2}`}
          />
        </Svg>
      </View>
      <Text style={styles.label}>{`Putting your ${weekday} together...`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: SIZE },
  faceBox: { width: SIZE, height: SIZE },
  ring: { position: 'absolute', left: 0, top: 0 },
  label: { flexShrink: 1, fontSize: 13, lineHeight: 16, color: colors.inkSecondary },
});
