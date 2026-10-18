// The black pill from design/Canvas.dc.html: what changed, and an "Undo" button (accentTint on toastRaised).
// The screen decides when it shows and hides.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export type UndoToastProps = {
  message: string;
  onUndo: () => void;
};

export function UndoToast({ message, onUndo }: UndoToastProps) {
  return (
    <View style={styles.pill} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.message} numberOfLines={2}>
        {message}
      </Text>
      <Pressable
        onPress={onUndo}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Undo this change"
        style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
      >
        <Text style={styles.undoText}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: 8,
    paddingLeft: 18,
    paddingRight: 10,
    borderRadius: 22,
    backgroundColor: colors.ink,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 6,
  },
  message: { flexShrink: 1, fontSize: 14, lineHeight: 18, color: colors.white },
  undo: { height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.toastRaised, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  undoText: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.accentTint },
});
