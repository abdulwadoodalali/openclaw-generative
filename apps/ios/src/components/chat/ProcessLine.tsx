// "Thought for 8s · 3 steps": one collapsed line above an answer. Tap to expand the thinking text and
// the steps Ano took. Hidden when there was neither thinking nor a step.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AnswerProcess } from '../../state/AnoProvider';
import { colors, type } from '../../theme';
import { ChevronRightIcon, CheckIcon } from '../CanvasIcons';
import { useReduceMotion } from './useReduceMotion';

export function ProcessLine({ process }: { process: AnswerProcess }) {
  const [open, setOpen] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (reduce) {
      turn.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, reduce, turn]);

  const thinking = process.thinking?.trim() ?? '';
  const stepCount = process.steps.length;
  if (!thinking && stepCount === 0) return null;

  const parts: string[] = [];
  if (thinking) parts.push(process.seconds !== null ? `Thought for ${process.seconds}s` : 'Thought');
  if (stepCount > 0) parts.push(`${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`);
  const summary = parts.join(' \u00B7 ');

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityState={{ expanded: open }}
        style={styles.row}
      >
        <Text style={styles.summary}>{summary}</Text>
        <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }}>
          <ChevronRightIcon size={12} color={colors.inkTertiary} />
        </Animated.View>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {thinking ? <Text style={styles.thinking}>{thinking}</Text> : null}
          {process.steps.map((step, index) => (
            <View key={`${step.label}-${index}`} style={styles.step}>
              <CheckIcon size={12} color={colors.householdText} />
              <Text style={styles.stepLabel}>{step.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  summary: { ...type.secondary, color: colors.inkSecondary, fontVariant: ['tabular-nums'] },
  body: { marginLeft: 12, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.border, gap: 6, paddingBottom: 4 },
  thinking: { fontSize: 14, lineHeight: 20, color: colors.inkSecondary },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLabel: { fontSize: 13, lineHeight: 18, color: colors.inkSecondary },
});
