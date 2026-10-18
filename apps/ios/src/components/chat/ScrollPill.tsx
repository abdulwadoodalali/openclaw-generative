// The floating pill above the composer when the list is not at the bottom: "Reading" with a down
// arrow while an answer streams, "Jump to bottom" when it is done. 36pt, white, warm shadow.
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { colors, shadows, type } from '../../theme';
import { ArrowDownIcon } from './icons';
import { useReduceMotion } from './useReduceMotion';

export function ScrollPill({ visible, streaming, onPress }: { visible: boolean; streaming: boolean; onPress: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    const target = visible ? 1 : 0;
    if (reduce) {
      fade.setValue(target);
      return;
    }
    Animated.timing(fade, { toValue: target, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [visible, reduce, fade]);

  const label = streaming ? 'Reading' : 'Jump to bottom';
  return (
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={[styles.wrap, { opacity: fade }]}>
      <Pressable
        onPress={onPress}
        hitSlop={{ top: 4, bottom: 4 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <ArrowDownIcon size={14} color={colors.ink} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center' },
  pill: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  label: { ...type.secondary, fontWeight: '600', color: colors.ink },
  pressed: { opacity: 0.8 },
});
