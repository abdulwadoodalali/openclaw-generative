// Long-press on a chat in the sidebar: Rename, Pin or Unpin, Delete (with a confirmation step).
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Thread } from '../../openclaw/sessionsApi';
import { colors, radii } from '../../theme';
import { PinIcon } from '../CanvasIcons';
import { Sheet } from '../Sheet';
import { Button, Input } from '../ui';
import { PencilIcon, TrashIcon } from './icons';

export type ThreadMenuProps = {
  thread: Thread | null;
  onClose: () => void;
  onRename: (thread: Thread, title: string) => void;
  onPin: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
};

type Step = 'menu' | 'rename' | 'delete';

export function ThreadMenu({ thread, onClose, onRename, onPin, onDelete }: ThreadMenuProps) {
  const [step, setStep] = useState<Step>('menu');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!thread) return;
    setStep('menu');
    setTitle(thread.title);
  }, [thread]);

  const save = () => {
    if (!thread || !title.trim()) return;
    onClose();
    onRename(thread, title.trim());
  };

  return (
    <Sheet visible={thread !== null} onClose={onClose} label="Chat actions" maxHeightFraction={0.5} contentStyle={styles.content}>
      {thread && step === 'menu' ? (
        <>
          <Text style={styles.title} numberOfLines={1}>
            {thread.title}
          </Text>
          <Row icon={<PencilIcon size={20} color={colors.ink} />} label="Rename" onPress={() => setStep('rename')} />
          <Row
            icon={<PinIcon size={20} color={colors.ink} />}
            label={thread.pinned ? 'Unpin' : 'Pin'}
            onPress={() => {
              onClose();
              onPin(thread);
            }}
          />
          <Row icon={<TrashIcon size={20} color={colors.danger} />} label="Delete" danger onPress={() => setStep('delete')} />
        </>
      ) : null}

      {thread && step === 'rename' ? (
        <View style={styles.form}>
          <Text style={styles.title}>Rename chat</Text>
          <Input value={title} onChangeText={setTitle} autoFocus accessibilityLabel="Chat title" returnKeyType="done" onSubmitEditing={save} />
          <Button disabled={!title.trim()} onPress={save}>
            Save
          </Button>
        </View>
      ) : null}

      {thread && step === 'delete' ? (
        <View style={styles.form}>
          <Text style={styles.title}>Delete this chat?</Text>
          <Text style={styles.body}>It leaves your chat list. This cannot be undone from the app.</Text>
          <Button
            variant="destructive"
            onPress={() => {
              onClose();
              onDelete(thread);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onPress={() => setStep('menu')}>
            Cancel
          </Button>
        </View>
      ) : null}
    </Sheet>
  );
}

function Row({ icon, label, danger = false, onPress }: { icon: React.ReactNode; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {icon}
      <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 4 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink, paddingHorizontal: 4, paddingBottom: 6 },
  body: { fontSize: 14, lineHeight: 20, color: colors.inkSecondary, paddingHorizontal: 4 },
  form: { gap: 12 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: radii.group },
  rowPressed: { backgroundColor: colors.fill },
  label: { fontSize: 16, lineHeight: 22, color: colors.ink },
  danger: { color: colors.danger },
});
