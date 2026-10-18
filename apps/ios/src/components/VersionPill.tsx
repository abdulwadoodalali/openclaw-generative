// "v6 · Ano, 2 min ago": the white pill at the top right of design/Canvas.dc.html. Tapping it opens
// the version history (the screen owns the sheet).
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { CanvasAuthor } from '../canvas/types';
import { versionLabel } from '../lib/relativeTime';
import { colors } from '../theme';

export type VersionPillProps = {
  version: number;
  by: CanvasAuthor;
  at: number;
  onPress?: () => void;
};

export function VersionPill({ version, by, at, onPress }: VersionPillProps) {
  const label = versionLabel(version, by, at);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={`Version ${version}, ${by === 'ano' ? 'Ano' : 'you'}`}
      accessibilityHint="Opens the version history"
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.white,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  pressed: { opacity: 0.7 },
  text: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
});
