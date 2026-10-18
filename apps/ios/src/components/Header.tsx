// The chat header (56pt): sidebar button, the agent block (face, name, live status; one button that
// opens the agent sheet) and the new chat button. It says who you talk to; how it thinks lives in
// the composer.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { AgentFace } from './chat/AgentFace';
import { ComposeIcon, MenuIcon } from './chat/icons';
import { useReduceMotion } from './chat/useReduceMotion';

export type HeaderProps = {
  agentId: string;
  agentName: string;
  agentInitial: string;
  /** "Here with you", "Thinking", "Checking Budget", "Offline". */
  status: string;
  running: boolean;
  offline: boolean;
  onOpenSidebar: () => void;
  onOpenAgents: () => void;
  onNewChat: () => void;
};

const FADE_MS = 150;

export function Header({ agentId, agentName, agentInitial, status, running, offline, onOpenSidebar, onOpenAgents, onNewChat }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 12 : insets.top;

  return (
    <View style={[styles.container, { paddingTop }]}>
      <View style={styles.row}>
        <Pressable
          onPress={onOpenSidebar}
          accessibilityRole="button"
          accessibilityLabel="Chats and menu"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <MenuIcon size={22} color={colors.ink} />
        </Pressable>

        <Pressable
          onPress={onOpenAgents}
          accessibilityRole="button"
          accessibilityLabel={`${agentName}. ${status}. Change agent`}
          style={({ pressed }) => [styles.agent, pressed && styles.pressed]}
        >
          <AgentFace agentId={agentId} initial={agentInitial} size={28} breathing={running} dim={offline} />
          <View style={styles.agentText}>
            <Text style={styles.name} numberOfLines={1}>
              {agentName}
            </Text>
            <FadingStatus text={status} />
          </View>
        </Pressable>

        <Pressable
          onPress={onNewChat}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <ComposeIcon size={22} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

/** The status line: when the text changes the old one fades out in 150ms and the new one fades in. */
function FadingStatus({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const opacity = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (text === shown) return;
    if (reduce) {
      setShown(text);
      return;
    }
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS / 2, useNativeDriver: true }).start(() => {
      setShown(text);
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS / 2, useNativeDriver: true }).start();
    });
  }, [text, shown, opacity, reduce]);

  return (
    <Animated.Text style={[styles.status, { opacity }]} numberOfLines={1} accessibilityLiveRegion="polite">
      {shown}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.bg },
  row: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  agent: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  agentText: { flexShrink: 1 },
  name: { fontSize: 15, lineHeight: 18, fontWeight: '600', color: colors.ink },
  status: { ...type.caption, color: colors.inkSecondary },
  pressed: { opacity: 0.6 },
});
