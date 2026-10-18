// The strip above the composer when something is wrong: the gateway is offline, or a run failed.
// 40pt, accent tint, one line of text and a bold action. The draft in the field is never touched.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../../theme';

export type ErrorStripProps = {
  message: string;
  actionLabel: string;
  onAction: () => void;
  /** Optional second action, e.g. "Settings". */
  secondaryLabel?: string;
  onSecondary?: () => void;
};

export function ErrorStrip({ message, actionLabel, onAction, secondaryLabel, onSecondary }: ErrorStripProps) {
  return (
    <View style={styles.strip} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      {secondaryLabel && onSecondary ? (
        <Pressable onPress={onSecondary} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} accessibilityRole="button" accessibilityLabel={secondaryLabel}>
          <Text style={styles.secondary}>{secondaryLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} accessibilityRole="button" accessibilityLabel={actionLabel}>
        <Text style={styles.action}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: 40,
    marginHorizontal: 16,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.accentTint,
  },
  message: { flex: 1, ...type.secondary, color: colors.accentText },
  secondary: { ...type.secondary, color: colors.accentText },
  action: { ...type.secondary, fontWeight: '700', color: colors.accentText },
});
