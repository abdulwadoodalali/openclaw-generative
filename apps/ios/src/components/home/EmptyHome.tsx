// Home before Ano has put anything on it: one card with a primary "Set up my Home" and two chips.
// Both go through the Customize runner, so the brief appears on this screen when Ano is done.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadows } from '../../theme';
import { tapMedium } from '../chat/haptics';
import { Chip } from './Chip';

export const EMPTY_HOME_CHIPS = ['Add my budget', 'Show my week'] as const;

export type EmptyHomeProps = {
  /** False while the gateway is not connected: the card stays visible but cannot send. */
  ready: boolean;
  onSetup: () => void;
  onChip: (text: string) => void;
};

export function EmptyHome({ ready, onSetup, onChip }: EmptyHomeProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        Let Ano set up your Home
      </Text>
      <Text style={styles.body}>I can put your day here: tasks, money and what's coming up.</Text>
      <Pressable
        onPress={() => {
          void tapMedium();
          onSetup();
        }}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel="Set up my Home"
        accessibilityState={{ disabled: !ready }}
        style={({ pressed }) => [styles.primary, !ready && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>Set up my Home</Text>
      </Pressable>
      <View style={styles.chips}>
        {EMPTY_HOME_CHIPS.map((label) => (
          <Chip key={label} label={label} onPress={onChip} disabled={!ready} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, borderRadius: radii.card, backgroundColor: colors.surface, ...shadows.card },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink },
  body: { fontSize: 15, lineHeight: 21, color: colors.inkSecondary },
  primary: {
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
