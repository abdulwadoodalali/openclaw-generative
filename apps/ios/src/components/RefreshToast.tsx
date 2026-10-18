// What a refresh started from a tile did: the summary with Undo (restores the previous version), or
// the error. Mount it when a refresh is started; it ignores whatever happened before it mounted.
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCanvasEditor } from '../canvas/useCanvasEditor';
import { useCanvas } from '../screens/useCanvases';
import { useUndoToast } from '../screens/useUndoToast';
import { colors, radii } from '../theme';
import { UndoToast } from './UndoToast';

export type RefreshToastProps = {
  canvasId: string;
  /** Distance from the bottom edge of the screen. */
  bottom: number;
};

export function RefreshToast({ canvasId, bottom }: RefreshToastProps) {
  const editor = useCanvasEditor(canvasId);
  const canvas = useCanvas(canvasId);
  const before = useRef(editor.lastChange);
  const undoToast = useUndoToast(canvasId, editor.lastChange === before.current ? null : editor.lastChange);
  const showUndo = undoToast.toast !== null && canvas?.version === undoToast.toast.version;

  if (!showUndo && !editor.error) return null;
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      {editor.error ? (
        <Pressable
          onPress={editor.clearError}
          accessibilityRole="button"
          accessibilityLabel={`Error: ${editor.error}. Tap to dismiss`}
          style={styles.errorNote}
        >
          <Text style={styles.errorText}>{editor.error}</Text>
        </Pressable>
      ) : undoToast.toast ? (
        <UndoToast message={undoToast.toast.summary} onUndo={undoToast.undo} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  errorNote: { padding: 12, borderRadius: radii.group, backgroundColor: colors.accentTint },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.accentText },
});
