// Bottom sheets for managing a canvas: the actions menu (Pin or Unpin, Rename, Delete with a
// confirmation step, all inside one sheet so nothing has to present on top of a closing modal), the
// plain rename sheet, and the version history with Restore.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_TITLE_LENGTH, type Canvas } from '../canvas/types';
import { relativeTime } from '../lib/relativeTime';
import { colors, radii } from '../theme';
import { LockIcon, PinIcon, RefreshIcon, UnlockIcon } from './CanvasIcons';
import { Sheet } from './Sheet';
import { Input } from './ui';

function SheetTitle({ children }: { children: string }) {
  return (
    <Text style={styles.sheetTitle} accessibilityRole="header">
      {children}
    </Text>
  );
}

function ActionRow({ label, onPress, destructive = false, icon }: { label: string; onPress: () => void; destructive?: boolean; icon?: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {icon}
      <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
    </Pressable>
  );
}

function RenameForm({ initial, onSave, onCancel }: { initial: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial;
  return (
    <View style={styles.form}>
      <Input
        value={text}
        onChangeText={setText}
        autoFocus
        maxLength={MAX_TITLE_LENGTH}
        returnKeyType="done"
        onSubmitEditing={() => canSave && onSave(trimmed)}
        accessibilityLabel="Canvas title"
        placeholder="Canvas title"
      />
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" style={({ pressed }) => [styles.button, styles.buttonOutline, pressed && styles.pressed]}>
          <Text style={styles.buttonOutlineLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => canSave && onSave(trimmed)}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save title"
          accessibilityState={{ disabled: !canSave }}
          style={({ pressed }) => [styles.button, styles.buttonDark, !canSave && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.buttonDarkLabel}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function RenameCanvasSheet({ visible, title, onClose, onSave }: { visible: boolean; title: string; onClose: () => void; onSave: (title: string) => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Rename canvas" header={<SheetTitle>Rename canvas</SheetTitle>}>
      <RenameForm initial={title} onSave={onSave} onCancel={onClose} />
    </Sheet>
  );
}

export type CanvasActionsSheetProps = {
  /** The canvas the menu is for; null closes the sheet. */
  canvas: Canvas | null;
  onClose: () => void;
  onRefresh: (canvas: Canvas) => void;
  onToggleLock: (canvas: Canvas) => void;
  onSetupAgent: (canvas: Canvas) => void;
  onTogglePin: (canvas: Canvas) => void;
  onRename: (canvas: Canvas, title: string) => void;
  onDelete: (canvas: Canvas) => void;
};

export function CanvasActionsSheet({ canvas, onClose, onRefresh, onToggleLock, onSetupAgent, onTogglePin, onRename, onDelete }: CanvasActionsSheetProps) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const id = canvas?.id;
  useEffect(() => setMode('menu'), [id]);
  // Keep the last canvas while the sheet slides away so the content does not flash empty.
  const [shown, setShown] = useState<Canvas | null>(canvas);
  useEffect(() => {
    if (canvas) setShown(canvas);
  }, [canvas]);
  const c = canvas ?? shown;

  return (
    <Sheet
      visible={canvas !== null}
      onClose={onClose}
      label={c ? `${c.title} options` : 'Canvas options'}
      header={<SheetTitle>{mode === 'rename' ? 'Rename canvas' : mode === 'delete' ? 'Delete canvas?' : c?.title ?? ''}</SheetTitle>}
    >
      {c && mode === 'menu' ? (
        <View style={styles.group}>
          <ActionRow
            label="Refresh now"
            icon={<RefreshIcon size={18} color={colors.ink} />}
            onPress={() => {
              onRefresh(c);
              onClose();
            }}
          />
          <ActionRow
            label={c.locked ? 'Unlock' : 'Lock'}
            icon={c.locked ? <UnlockIcon size={18} color={colors.ink} /> : <LockIcon size={18} color={colors.ink} />}
            onPress={() => {
              onToggleLock(c);
              onClose();
            }}
          />
          <ActionRow
            label="Set up agent"
            onPress={() => {
              onSetupAgent(c);
              onClose();
            }}
          />
          <ActionRow
            label={c.pinned ? 'Unpin from Home' : 'Pin to Home'}
            icon={<PinIcon size={18} color={colors.ink} />}
            onPress={() => {
              onTogglePin(c);
              onClose();
            }}
          />
          <ActionRow label="Rename" onPress={() => setMode('rename')} />
          <ActionRow label="Delete" destructive onPress={() => setMode('delete')} />
        </View>
      ) : null}
      {c && mode === 'rename' ? (
        <RenameForm
          initial={c.title}
          onCancel={() => setMode('menu')}
          onSave={(title) => {
            onRename(c, title);
            onClose();
          }}
        />
      ) : null}
      {c && mode === 'delete' ? (
        <View style={styles.form}>
          <Text style={styles.body}>
            {`"${c.title}" and its ${c.history.length} saved ${c.history.length === 1 ? 'version' : 'versions'} will be removed from this phone. This cannot be undone.`}
          </Text>
          <View style={styles.buttons}>
            <Pressable onPress={() => setMode('menu')} accessibilityRole="button" accessibilityLabel="Keep canvas" style={({ pressed }) => [styles.button, styles.buttonOutline, pressed && styles.pressed]}>
              <Text style={styles.buttonOutlineLabel}>Keep</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onDelete(c);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Delete canvas"
              style={({ pressed }) => [styles.button, styles.buttonDanger, pressed && styles.pressed]}
            >
              <Text style={styles.buttonDarkLabel}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

export type VersionsSheetProps = {
  visible: boolean;
  canvas: Canvas | undefined;
  onClose: () => void;
  onRestore: (version: number) => void;
};

/** Every kept version, newest first, each with its summary, author, time and a Restore action. */
export function VersionsSheet({ visible, canvas, onClose, onRestore }: VersionsSheetProps) {
  const versions = canvas ? [...canvas.history].reverse() : [];
  return (
    <Sheet visible={visible} onClose={onClose} label="Version history" header={<SheetTitle>Version history</SheetTitle>}>
      {versions.map((v) => {
        const current = canvas !== undefined && v.version === canvas.version;
        return (
          <View key={v.version} style={styles.versionRow}>
            <View style={styles.versionText}>
              <Text style={styles.versionTitle} numberOfLines={2}>
                {`v${v.version} \u00B7 ${v.summary}`}
              </Text>
              <Text style={styles.versionMeta}>{`${v.by === 'ano' ? 'Ano' : 'You'}, ${relativeTime(v.at)}`}</Text>
            </View>
            {current ? (
              <Text style={styles.currentTag} accessibilityLabel="Current version">
                Current
              </Text>
            ) : (
              <Pressable
                onPress={() => {
                  onRestore(v.version);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Restore version ${v.version}`}
                style={({ pressed }) => [styles.restore, pressed && styles.pressed]}
              >
                <Text style={styles.restoreLabel}>Restore</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheetTitle: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink },
  group: { backgroundColor: colors.white, borderRadius: radii.group, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { fontSize: 16, lineHeight: 21, color: colors.ink },
  rowLabelDestructive: { color: colors.danger },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  form: { gap: 16 },
  body: { fontSize: 15, lineHeight: 21, color: colors.inkSecondary },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  buttonOutline: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.white },
  buttonOutlineLabel: { fontSize: 16, lineHeight: 21, color: colors.ink },
  buttonDark: { backgroundColor: colors.ink },
  buttonDanger: { backgroundColor: colors.danger },
  buttonDarkLabel: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.white },
  versionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.group,
    backgroundColor: colors.white,
  },
  versionText: { flex: 1, gap: 2 },
  versionTitle: { fontSize: 15, lineHeight: 20, color: colors.ink },
  versionMeta: { fontSize: 13, lineHeight: 16, color: colors.inkSecondary },
  currentTag: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.chip, backgroundColor: colors.fill },
  restore: { minHeight: 44, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  restoreLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.accentText },
});
