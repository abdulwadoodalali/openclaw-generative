// A suggestion pill (36pt, fill background): "Add my budget", "Show my week". One tap sends it.
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../theme';
import { tapSelection } from '../chat/haptics';

export function Chip({ label, onPress, disabled = false }: { label: string; onPress: (label: string) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => {
        void tapSelection();
        onPress(label);
      }}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.chip, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.4 },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600', color: colors.ink },
});
