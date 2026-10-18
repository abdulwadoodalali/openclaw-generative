// What Home shows while Ano builds the brief for the first time: two brief-shaped cards whose lines
// shimmer warmly (fill colour, opacity 0.45 to 0.9, 900ms). Reduce Motion holds them still.
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { colors, radii } from '../../theme';
import { useReduceMotion } from '../chat/useReduceMotion';

const NATIVE = Platform.OS !== 'web';

function Line({ width, height = 14, opacity }: { width: `${number}%`; height?: number; opacity: Animated.Value }) {
  return <Animated.View style={[styles.line, { width, height, opacity }]} />;
}

export function HomeSkeleton() {
  const opacity = useRef(new Animated.Value(0.45)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (reduce) {
      opacity.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 900, useNativeDriver: NATIVE }),
        Animated.timing(opacity, { toValue: 0.45, duration: 900, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduce]);

  return (
    <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1].map((i) => (
        <View key={i} style={styles.card}>
          <Line width="30%" height={10} opacity={opacity} />
          <Line width="70%" height={16} opacity={opacity} />
          <Line width="50%" opacity={opacity} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: { padding: 16, gap: 10, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  line: { borderRadius: 6, backgroundColor: colors.fill },
});
