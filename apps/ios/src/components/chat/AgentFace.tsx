// An agent's face: a circle in the scope tint (amber for personal agents, sage for household ones)
// with the agent's initial in SF Pro Rounded. While `breathing` it scales 1 to 1.04 and back.
// Reduce Motion holds it still. `dim` is the offline look.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { agentTone } from '../../chat/agents';
import { colors, fonts } from '../../theme';
import { useReduceMotion } from './useReduceMotion';

export type AgentFaceProps = {
  agentId: string;
  initial: string;
  /** 28 in the header, 36 in rows and sheets, 64 on the empty chat. */
  size?: number;
  breathing?: boolean;
  dim?: boolean;
};

const BREATH_MS = 1600;

export function AgentFace({ agentId, initial, size = 36, breathing = false, dim = false }: AgentFaceProps) {
  const tone = agentTone(agentId);
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (!breathing || reduce) {
      scale.setValue(1);
      return;
    }
    const half = { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true };
    const loop = Animated.loop(
      Animated.sequence([Animated.timing(scale, { toValue: 1.04, ...half }), Animated.timing(scale, { toValue: 1, ...half })]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathing, reduce, scale]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.face,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'household' ? colors.householdTint : colors.accentTint,
          opacity: dim ? 0.5 : 1,
          transform: [{ scale }],
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fonts.rounded,
          fontWeight: '700',
          fontSize: Math.round(size * 0.44),
          lineHeight: Math.round(size * 0.56),
          color: tone === 'household' ? colors.householdText : colors.accentText,
        }}
      >
        {initial}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center' },
});
