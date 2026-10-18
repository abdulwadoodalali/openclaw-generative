// The "+" menu of the composer: Photo library and Camera.
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii } from '../../theme';
import { Sheet } from '../Sheet';
import { CameraIcon, ImageIcon } from './icons';

export type AttachSheetProps = {
  visible: boolean;
  onClose: () => void;
  onPick: (source: 'library' | 'camera') => void;
};

export function AttachSheet({ visible, onClose, onPick }: AttachSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Add a photo" maxHeightFraction={0.4} contentStyle={styles.content}>
      <Pressable
        onPress={() => onPick('library')}
        accessibilityRole="button"
        accessibilityLabel="Photo library"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <ImageIcon size={22} color={colors.ink} />
        <Text style={styles.label}>Photo library</Text>
      </Pressable>
      <Pressable
        onPress={() => onPick('camera')}
        accessibilityRole="button"
        accessibilityLabel="Camera"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <CameraIcon size={22} color={colors.ink} />
        <Text style={styles.label}>Camera</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 4 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: radii.group },
  label: { fontSize: 16, lineHeight: 22, color: colors.ink },
  pressed: { backgroundColor: colors.fill },
});
