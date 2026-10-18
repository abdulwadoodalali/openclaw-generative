// "Change your Home": a half-height sheet that is a small chat bound to the Home canvas. What you
// type here is an edit request to the canvas runner; Home updates live behind the sheet, the orb
// runs while Ano works, and the Undo toast shows after a change. The last exchange (your request and
// Ano's one-line reply) is what the runner remembers, so reopening the sheet shows it again.
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import type { CanvasEditor } from '../../canvas/useCanvasEditor';
import { colors, fonts, radii } from '../../theme';
import { tapLight } from '../chat/haptics';
import { ArrowUpIcon, StopIcon, XIcon } from '../Icons';
import { RunActivityRow } from '../RunActivityRow';
import { Sheet } from '../Sheet';
import { UndoToast } from '../UndoToast';
import { Chip } from './Chip';

export const CUSTOMIZE_CHIPS = ['Add my budget', 'Show my week', 'Make it calmer'] as const;

export type CustomizeSheetProps = {
  visible: boolean;
  onClose: () => void;
  editor: CanvasEditor;
  /** False while the gateway is not connected. */
  ready: boolean;
  /** Set while the undo toast of the last change is showing. */
  toast: { message: string; onUndo: () => void } | null;
};

export function CustomizeSheet({ visible, onClose, editor, ready, toast }: CustomizeSheetProps) {
  const [text, setText] = useState('');
  const { running, exchange, error } = editor;

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !ready || running) return;
    setText('');
    void tapLight();
    void editor.send(trimmed);
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">
        Change your Home
      </Text>
      <Pressable
        onPress={onClose}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <XIcon size={18} color={colors.inkSecondary} />
      </Pressable>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {toast ? <UndoToast message={toast.message} onUndo={toast.onUndo} /> : null}
      <View style={styles.fieldRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit(text)}
          placeholder="Change your Home..."
          placeholderTextColor={colors.inkSecondary}
          returnKeyType="send"
          submitBehavior="submit"
          editable={ready}
          accessibilityLabel="Change your Home"
          style={[styles.field, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null]}
        />
        {running ? (
          <Pressable
            onPress={editor.stop}
            accessibilityRole="button"
            accessibilityLabel="Stop"
            style={({ pressed }) => [styles.send, styles.stop, pressed && styles.pressed]}
          >
            <StopIcon size={18} color={colors.white} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => submit(text)}
            disabled={!ready || text.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !ready || text.trim().length === 0 }}
            style={({ pressed }) => [styles.send, (!ready || text.trim().length === 0) && styles.sendIdle, pressed && styles.pressed]}
          >
            <ArrowUpIcon size={20} color={text.trim().length === 0 ? colors.inkTertiary : colors.white} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} header={header} footer={footer} maxHeightFraction={0.6} label="Change your Home">
      {exchange ? (
        <View style={styles.exchange}>
          <View style={styles.bubbleRow}>
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{exchange.request}</Text>
            </View>
          </View>
          {!running && exchange.reply ? <Text style={styles.reply}>{exchange.reply}</Text> : null}
        </View>
      ) : !running ? (
        <Text style={styles.hint}>Tell Ano what to change. Your Home updates behind this sheet.</Text>
      ) : null}

      {running ? (
        <View style={styles.working}>
          <RunActivityRow activity={editor.activity} />
        </View>
      ) : null}

      {error ? (
        <Pressable
          onPress={editor.clearError}
          accessibilityRole="button"
          accessibilityLabel={`Error: ${error}. Tap to dismiss`}
          style={styles.errorNote}
        >
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}

      {!running ? (
        <View style={styles.chips}>
          {CUSTOMIZE_CHIPS.map((label) => (
            <Chip key={label} label={label} onPress={submit} disabled={!ready} />
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8 },
  title: { fontFamily: fonts.rounded, fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.ink },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  hint: { fontSize: 15, lineHeight: 21, color: colors.inkSecondary },
  exchange: { gap: 12 },
  bubbleRow: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.accent,
    borderTopLeftRadius: radii.bubble,
    borderTopRightRadius: radii.bubble,
    borderBottomLeftRadius: radii.bubble,
    borderBottomRightRadius: radii.bubbleTail,
  },
  bubbleText: { fontSize: 16, lineHeight: 22, color: colors.white },
  reply: { fontSize: 16, lineHeight: 23, color: colors.ink },
  working: { paddingVertical: 4 },
  errorNote: { padding: 12, borderRadius: radii.group, backgroundColor: colors.accentTint },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.accentText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { gap: 10, paddingBottom: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  field: {
    flex: 1,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.ink,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  sendIdle: { backgroundColor: colors.fill },
  stop: { backgroundColor: colors.ink },
});
