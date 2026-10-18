// What you can do with a message: the icon row under the latest answer (Copy, Retry, Pin, More) and
// the sheet that long-press opens on any message. Copy morphs into a sage check for 1.5s.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, radii } from '../../theme';
import { CheckIcon, PinIcon, RefreshIcon } from '../CanvasIcons';
import { Sheet } from '../Sheet';
import { tapSuccess } from './haptics';
import { CopyIcon, MoreIcon } from './icons';

const COPIED_MS = 1500;

/** Copies text, and reports `copied` for 1.5s afterwards (for the check). */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    void Clipboard.setStringAsync(text).then(() => {
      void tapSuccess();
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  return { copied, copy };
}

export type ActionBarProps = {
  text: string;
  onRetry?: () => void;
  onPin?: () => void;
  onMore: () => void;
};

export function ActionBar({ text, onRetry, onPin, onMore }: ActionBarProps) {
  const { copied, copy } = useCopy();
  return (
    <View style={styles.bar}>
      <IconButton label={copied ? 'Copied' : 'Copy answer'} onPress={() => copy(text)}>
        {copied ? <CheckIcon size={18} color={colors.household} /> : <CopyIcon size={18} color={colors.inkSecondary} />}
      </IconButton>
      {onRetry ? (
        <IconButton label="Try again" onPress={onRetry}>
          <RefreshIcon size={18} color={colors.inkSecondary} />
        </IconButton>
      ) : null}
      {onPin ? (
        <IconButton label="Pin as canvas" onPress={onPin}>
          <PinIcon size={18} color={colors.inkSecondary} />
        </IconButton>
      ) : null}
      <IconButton label="More" onPress={onMore}>
        <MoreIcon size={18} color={colors.inkSecondary} />
      </IconButton>
    </View>
  );
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

export type MenuAction = { key: string; label: string; icon: React.ReactNode; onPress: () => void };

/** The long-press (and "More") sheet of one message. */
export function MessageMenu({ visible, onClose, actions }: { visible: boolean; onClose: () => void; actions: MenuAction[] }) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Message actions" maxHeightFraction={0.6} contentStyle={styles.menu}>
      {actions.map((action) => (
        <Pressable
          key={action.key}
          onPress={() => {
            onClose();
            action.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
        >
          {action.icon}
          <Text style={styles.menuLabel}>{action.label}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -12 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  menu: { gap: 4 },
  menuRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: radii.group },
  menuRowPressed: { backgroundColor: colors.fill },
  menuLabel: { fontSize: 16, lineHeight: 22, color: colors.ink },
});
