// Messages typed while Ano is working wait above the composer, one 40pt pill each (three at most,
// then "+N"). "Send now" steers the running reply; the x puts the text back in the field. After a
// stop or a failure the queue is paused and the action reads "Resume".
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueuedTurn } from '../../state/AnoProvider';
import { colors, type } from '../../theme';
import { XIcon } from '../Icons';
import { useReduceMotion } from './useReduceMotion';

export type QueuedPillsProps = {
  queue: ReadonlyArray<QueuedTurn>;
  paused: boolean;
  onSendNow: (id: string) => void;
  onResume: () => void;
  onRestore: (id: string) => void;
};

const MAX_VISIBLE = 3;

export function QueuedPills({ queue, paused, onSendNow, onResume, onRestore }: QueuedPillsProps) {
  if (queue.length === 0) return null;
  const visible = queue.slice(0, MAX_VISIBLE);
  const hidden = queue.length - visible.length;
  return (
    <View style={styles.wrap}>
      {visible.map((item) => (
        <Pill key={item.id} item={item} paused={paused} onSendNow={onSendNow} onResume={onResume} onRestore={onRestore} />
      ))}
      {hidden > 0 ? <Text style={styles.more}>{`+${hidden} more queued`}</Text> : null}
    </View>
  );
}

function Pill({ item, paused, onSendNow, onResume, onRestore }: { item: QueuedTurn } & Omit<QueuedPillsProps, 'queue'>) {
  const rise = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) {
      rise.setValue(1);
      return;
    }
    Animated.spring(rise, { toValue: 1, damping: 22, stiffness: 260, mass: 1, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [rise, reduce]);

  const label = item.text || (item.images.length > 1 ? `${item.images.length} photos` : 'Photo');
  return (
    <Animated.View
      style={[styles.pill, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
      <Pressable
        onPress={() => (paused ? onResume() : onSendNow(item.id))}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Resume queued messages' : 'Send now'}
      >
        <Text style={styles.action}>{paused ? 'Resume' : 'Send now'}</Text>
      </Pressable>
      <Pressable
        onPress={() => onRestore(item.id)}
        accessibilityRole="button"
        accessibilityLabel="Take back to the message field"
        style={styles.remove}
      >
        <XIcon size={16} color={colors.inkSecondary} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  pill: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    borderRadius: 20,
    backgroundColor: colors.surfaceSheet,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { flex: 1, ...type.secondary, color: colors.inkSecondary },
  action: { ...type.secondary, fontWeight: '600', color: colors.accentText },
  remove: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  more: { ...type.caption, color: colors.inkSecondary, textAlign: 'center' },
});
