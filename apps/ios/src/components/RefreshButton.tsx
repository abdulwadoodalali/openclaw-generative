// The round "refresh" button (a circular arrow). While a refresh runs it shows the small Ano orb
// instead and does nothing, so a second tap cannot start a second run.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RunMode } from '../openclaw/OpenClawAgent';
import { visualForMode } from '../orb/orbMachine.ts';
import { colors, shadows } from '../theme';
import { AnoOrb } from './AnoOrb';
import { RefreshIcon } from './CanvasIcons';

export type RefreshButtonProps = {
  refreshing: boolean;
  onPress: () => void;
  /** What Ano is doing, to colour the orb. */
  mode?: RunMode;
  disabled?: boolean;
  label?: string;
  /** Diameter. Default 44; smaller ones keep a 44 touch area. */
  size?: number;
};

export function RefreshButton({ refreshing, onPress, mode = 'working', disabled = false, label = 'Refresh', size = 44 }: RefreshButtonProps) {
  const off = disabled || refreshing;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={refreshing ? `${label}. Refreshing now` : label}
      accessibilityState={{ disabled: off, busy: refreshing }}
      hitSlop={Math.max(0, Math.round((44 - size) / 2)) + 2}
      style={({ pressed }) => [styles.button, { width: size, height: size, borderRadius: size / 2 }, disabled && !refreshing && styles.disabled, pressed && styles.pressed]}
    >
      {refreshing ? (
        <View style={styles.orb}>
          <AnoOrb state={visualForMode(mode)} size={14} />
        </View>
      ) : (
        <RefreshIcon size={20} color={colors.ink} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  },
  orb: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
