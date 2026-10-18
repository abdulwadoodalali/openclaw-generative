// The sidebar: slides in from the left over the chat (85% wide, dim backdrop; tap the backdrop or
// swipe left to close). Search, a Home row, a Canvases row, Pinned and Recents by day (title, time,
// and the agent face for chats with any agent but the default), long-press for Rename / Pin / Delete, and Settings with the connection dot at the bottom.
// Plain overlay, not a Modal, so it stays out of the web DOM while closed. Reduce Motion: instant.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AgentOption } from '../../chat/agents';
import { DEFAULT_AGENT_ID } from '../../env';
import { searchThreads } from '../../chat/search';
import type { Thread } from '../../openclaw/sessionsApi';
import { colors, fonts, radii, type } from '../../theme';
import { ChevronRightIcon } from '../CanvasIcons';
import { GearIcon, GridIcon } from '../Icons';
import { groupByDay, rowTime } from './groupThreads';
import { HomeIcon, SearchIcon } from './icons';
import { ThreadMenu } from './ThreadMenu';
import { useReduceMotion } from './useReduceMotion';

// RN-web only: the default focus ring clashes with the filled search box.
const WEB_NO_OUTLINE = { outlineStyle: 'none' } as unknown as TextStyle;
/** Larger Dynamic Type grows the sidebar text up to this factor; beyond it the rows would truncate to nothing. */
const TEXT_SCALE = 1.3;

export type SidebarProps = {
  visible: boolean;
  onClose: () => void;
  threads: readonly Thread[];
  activeKey: string | null;
  agentFor: (id: string) => AgentOption;
  onSelect: (key: string) => void;
  onOpenCanvases: () => void;
  onRename: (thread: Thread, title: string) => void;
  onPin: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
  onOpenSettings: () => void;
  /** "Private · only you", "Offline", ... with the colour of its dot. */
  connectionText: string;
  connectionColor: string;
  /** Chats with this agent show no face (it is the one you almost always talk to). */
  defaultAgentId?: string;
  /** Shows the Home page (the sidebar closes itself first). */
  onGoHome: () => void;
};

const SLIDE_MS = 240;

export function Sidebar({
  visible,
  onClose,
  threads,
  activeKey,
  agentFor,
  onSelect,
  onOpenCanvases,
  onRename,
  onPin,
  onDelete,
  onOpenSettings,
  connectionText,
  connectionColor,
  defaultAgentId = DEFAULT_AGENT_ID,
  onGoHome,
}: SidebarProps) {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  // Wide enough to breathe on a phone, never a full-screen wall on large screens.
  const width = Math.min(Math.round(windowWidth * 0.86), 360);
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [query, setQuery] = useState('');
  const [menuThread, setMenuThread] = useState<Thread | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setQuery('');
    }
    const target = visible ? 1 : 0;
    if (reduce) {
      progress.setValue(target);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(progress, {
      toValue: target,
      duration: SLIDE_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, reduce, progress]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => progress.setValue(Math.max(0, Math.min(1, 1 + g.dx / width))),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -width * 0.25 || g.vx < -0.5) onClose();
          else Animated.timing(progress, { toValue: 1, duration: 140, useNativeDriver: Platform.OS !== 'web' }).start();
        },
      }),
    [progress, width, onClose],
  );

  const groups = useMemo(() => groupByDay(searchThreads(threads, query)), [threads, query]);

  if (!mounted) return null;

  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 16 : insets.top + 8;
  const go = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        accessibilityViewIsModal
        style={[styles.panel, { width, paddingTop, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }]}
      >
        <View style={styles.searchBox}>
          <SearchIcon size={18} color={colors.inkSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={colors.inkSecondary}
            accessibilityLabel="Search chats"
            returnKeyType="search"
            autoCorrect={false}
            maxFontSizeMultiplier={TEXT_SCALE}
            style={[styles.searchInput, Platform.OS === 'web' ? WEB_NO_OUTLINE : undefined]}
          />
        </View>

        <Pressable
          onPress={go(onGoHome)}
          accessibilityRole="button"
          accessibilityLabel="Home"
          style={({ pressed }) => [styles.canvasesRow, styles.homeRow, pressed && styles.pressed]}
        >
          <HomeIcon size={20} color={colors.ink} />
          <Text style={styles.canvasesLabel} maxFontSizeMultiplier={TEXT_SCALE}>Home</Text>
          <ChevronRightIcon size={16} color={colors.inkTertiary} />
        </Pressable>

        <Pressable
          onPress={go(onOpenCanvases)}
          accessibilityRole="button"
          accessibilityLabel="Canvases"
          style={({ pressed }) => [styles.canvasesRow, pressed && styles.pressed]}
        >
          <GridIcon size={20} color={colors.ink} />
          <Text style={styles.canvasesLabel} maxFontSizeMultiplier={TEXT_SCALE}>Canvases</Text>
          <ChevronRightIcon size={16} color={colors.inkTertiary} />
        </Pressable>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {groups.length === 0 ? (
            <Text style={styles.empty}>{query.trim() ? 'No chats match' : 'No chats yet'}</Text>
          ) : (
            groups.map((group) => (
              <View key={group.title}>
                <Text style={styles.groupTitle} maxFontSizeMultiplier={TEXT_SCALE}>{group.title}</Text>
                {group.threads.map((thread) => {
                  const agent = agentFor(thread.agentId);
                  const active = thread.key === activeKey;
                  return (
                    <Pressable
                      key={thread.key}
                      onPress={go(() => onSelect(thread.key))}
                      onLongPress={() => setMenuThread(thread)}
                      delayLongPress={350}
                      accessibilityRole="button"
                      accessibilityLabel={`${thread.title}, ${agent.name}`}
                      accessibilityState={{ selected: active }}
                      accessibilityActions={[{ name: 'longpress', label: 'Chat actions' }]}
                      onAccessibilityAction={() => setMenuThread(thread)}
                      style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
                    >
                      <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}>
                        {thread.title}
                      </Text>
                      {/* Titles get the full width; a chat with another agent says so next to its time. */}
                      <Text style={styles.rowTime} numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}>
                        {agent.id === defaultAgentId ? rowTime(thread.updatedAt) : `${agent.name} \u00B7 ${rowTime(thread.updatedAt)}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        <Pressable
          onPress={go(onOpenSettings)}
          accessibilityRole="button"
          accessibilityLabel={`Settings. ${connectionText}`}
          style={({ pressed }) => [styles.settings, { paddingBottom: Math.max(insets.bottom, 12) }, pressed && styles.pressed]}
        >
          <GearIcon size={20} color={colors.ink} />
          <Text style={styles.settingsLabel} maxFontSizeMultiplier={TEXT_SCALE}>Settings</Text>
          <View style={styles.spacer} />
          <View style={[styles.dot, { backgroundColor: connectionColor }]} />
          <Text style={styles.connection} numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}>
            {connectionText}
          </Text>
        </Pressable>
      </Animated.View>

      <ThreadMenu thread={menuThread} onClose={() => setMenuThread(null)} onRename={onRename} onPin={onPin} onDelete={onDelete} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 20, elevation: 20 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surfaceSheet,
    borderTopRightRadius: radii.sheet,
    borderBottomRightRadius: radii.sheet,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  searchBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  searchInput: { flex: 1, minHeight: 44, paddingVertical: 10, fontSize: 16, color: colors.ink },
  homeRow: { marginBottom: 8 },
  canvasesRow: {
    marginHorizontal: 16,
    minHeight: 50,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: radii.group,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  canvasesLabel: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.ink },
  list: { flex: 1, marginTop: 12 },
  listContent: { paddingHorizontal: 8, paddingBottom: 20 },
  groupTitle: { ...type.label, color: colors.inkSecondary, paddingHorizontal: 12, paddingTop: 20, paddingBottom: 8 },
  row: { minHeight: 52, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: radii.group },
  rowActive: { backgroundColor: colors.fill },
  rowTitle: { flex: 1, fontSize: 16, lineHeight: 21, color: colors.ink },
  rowTime: { ...type.caption, flexShrink: 0, color: colors.inkSecondary, fontVariant: ['tabular-nums'], fontFamily: fonts.body },
  empty: { ...type.secondary, color: colors.inkSecondary, textAlign: 'center', paddingTop: 32 },
  settings: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingsLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  spacer: { flex: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  connection: { ...type.caption, color: colors.inkSecondary, maxWidth: 130 },
  pressed: { opacity: 0.7 },
});
