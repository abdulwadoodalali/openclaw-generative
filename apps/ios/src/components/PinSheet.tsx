// "Pin these cards": the choice behind the Pin button in chat. Either make a new canvas (with its
// title and a Lock switch, on by default) or add the cards to the end of a canvas you already have.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { canvasStore } from '../canvas/instance';
import { MAX_TITLE_LENGTH, type Canvas, type CanvasBlock } from '../canvas/types';
import { useCanvases } from '../screens/useCanvases';
import { colors, radii, shadows, type } from '../theme';
import { LockIcon } from './CanvasIcons';
import { Sheet } from './Sheet';
import { Input, Switch } from './ui';

const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;

export type PinSheetProps = {
  visible: boolean;
  blocks: readonly CanvasBlock[];
  /** The title a new canvas starts with. */
  defaultTitle: string;
  /** The question that led to these cards (empty when unknown); a refresh asks it again. */
  prompt: string;
  /** The chat thread the cards came from, when it has one. */
  sessionKey: string | null;
  onClose: () => void;
  /** Called with the canvas the cards ended up on (new or existing). */
  onPinned: (canvas: Canvas) => void;
};

export function PinSheet({ visible, blocks, defaultTitle, prompt, sessionKey, onClose, onPinned }: PinSheetProps) {
  const all = useCanvases();
  const [title, setTitle] = useState(defaultTitle);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(defaultTitle);
    setLocked(true);
    setError(null);
    // Only when the sheet opens: a re-derived default must not overwrite what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const existing = useMemo(() => all.filter((c) => c.kind === 'user').sort((a, b) => b.updatedAt - a.updatedAt), [all]);
  const trimmed = title.trim();

  const createNew = () => {
    if (!trimmed) return;
    const created = canvasStore.create({
      title: trimmed,
      blocks: [...blocks],
      by: 'you',
      pinned: true,
      summary: 'Pinned from chat',
      locked,
      origin: prompt ? { prompt, sessionKey: sessionKey ?? undefined, at: Date.now() } : undefined,
    });
    onPinned(created);
    onClose();
  };

  const addTo = (target: Canvas) => {
    const result = canvasStore.append(target.id, [...blocks], 'you', `Added ${cards(blocks.length)} from chat`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onPinned(result.canvas);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      label="Pin these cards"
      header={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Pin these cards
          </Text>
          <Text style={styles.count}>{cards(blocks.length)}</Text>
        </View>
      }
    >
      <View style={styles.section}>
        <Text style={styles.label}>New canvas</Text>
        <View style={styles.card}>
          <Input
            value={title}
            onChangeText={setTitle}
            maxLength={MAX_TITLE_LENGTH}
            returnKeyType="done"
            onSubmitEditing={createNew}
            accessibilityLabel="Canvas title"
            placeholder="Canvas title"
          />
          <View style={styles.lockRow}>
            <LockIcon size={18} color={colors.ink} />
            <View style={styles.lockText}>
              <Text style={styles.lockTitle}>Lock it</Text>
              <Text style={styles.lockHint}>Tapping a card then asks Ano about it instead of changing the canvas.</Text>
            </View>
            <Switch checked={locked} onCheckedChange={setLocked} accessibilityLabel="Lock the new canvas" />
          </View>
          <Pressable
            onPress={createNew}
            disabled={!trimmed}
            accessibilityRole="button"
            accessibilityLabel="Pin as new canvas"
            accessibilityState={{ disabled: !trimmed }}
            style={({ pressed }) => [styles.primary, !trimmed && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>Pin as new canvas</Text>
          </Pressable>
        </View>
      </View>

      {existing.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>Add to existing</Text>
          <View style={styles.group}>
            {existing.map((c, i) => (
              <Pressable
                key={c.id}
                onPress={() => addTo(c)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${cards(blocks.length)} to ${c.title}${c.locked ? ', locked' : ''}`}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.pressed]}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {c.title}
                </Text>
                {c.locked ? <LockIcon size={14} color={colors.inkSecondary} strokeWidth={2.2} /> : null}
                <Text style={styles.rowMeta}>{`v${c.version}`}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink },
  count: { fontSize: 13, lineHeight: 16, color: colors.inkSecondary },
  section: { gap: 8 },
  label: { ...type.label, color: colors.inkSecondary },
  card: { backgroundColor: colors.white, borderRadius: radii.group, padding: 14, gap: 14, ...shadows.button },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  lockText: { flex: 1, gap: 2 },
  lockTitle: { fontSize: 16, lineHeight: 21, color: colors.ink },
  lockHint: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
  primary: { height: 48, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.white },
  group: { backgroundColor: colors.white, borderRadius: radii.group, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowTitle: { flex: 1, fontSize: 16, lineHeight: 21, color: colors.ink },
  rowMeta: { fontSize: 13, lineHeight: 16, color: colors.inkSecondary },
  error: { padding: 12, borderRadius: radii.group, backgroundColor: colors.accentTint },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.accentText },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
