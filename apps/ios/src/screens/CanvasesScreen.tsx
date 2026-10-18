// The list of saved canvases: every user canvas, newest first, in a two column grid of tiles.
// Long press a tile for Refresh now, Lock or Unlock, Set up agent, Pin, Rename and Delete. The Home
// canvas is never listed.
import React, { useCallback, useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '../components/CanvasIcons';
import { CanvasTile } from '../components/CanvasTile';
import { useChat } from '../state/AnoProvider';
import { colors, fonts, radii, shadows } from '../theme';
import { useAskInChat } from './useAskInChat';
import { useCanvasMenu } from './useCanvasMenu';
import { useCanvases } from './useCanvases';

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export function CanvasesScreen() {
  const insets = useSafeAreaInsets();
  const { openChat } = useAskInChat();
  const chat = useChat();
  const all = useCanvases();
  const menu = useCanvasMenu({ toastBottom: Math.max(insets.bottom, 24) + 8 });

  const canvases = useMemo(() => all.filter((c) => c.kind === 'user').sort((a, b) => b.updatedAt - a.updatedAt), [all]);
  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 56 : insets.top + 9;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const askForCanvas = useCallback(() => {
    chat.newThread(null);
    openChat();
  }, [chat, openChat]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop, paddingBottom: Math.max(insets.bottom, 24) + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <ChevronLeftIcon size={20} color={colors.accent} />
            <Text style={styles.backLabel}>Home</Text>
          </Pressable>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header">
            Canvases
          </Text>
          {canvases.length > 0 ? <Text style={styles.hint}>Touch and hold a canvas to refresh, lock, set up its agent, pin, rename or delete it.</Text> : null}
        </View>

        {canvases.length > 0 ? (
          <View style={styles.grid}>
            {chunk(canvases, 2).map((row, i) => (
              <View key={i} style={styles.gridRow}>
                {row.map((c) => (
                  <CanvasTile
                    key={c.id}
                    canvas={c}
                    variant="list"
                    onPress={() => router.push({ pathname: '/canvas/[id]', params: { id: c.id } })}
                    onLongPress={() => menu.openMenu(c.id)}
                  />
                ))}
                {row.length === 1 ? <View style={styles.spacer} /> : null}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No canvases yet</Text>
            <Text style={styles.emptyText}>
              A canvas is an answer you keep. Ask Ano for one, or pin any answer in chat, and it shows up here and on Home.
            </Text>
            <Pressable
              onPress={askForCanvas}
              accessibilityRole="button"
              accessibilityLabel="Ask Ano for a canvas"
              style={({ pressed }) => [styles.askButton, pressed && styles.pressed]}
            >
              <Text style={styles.askLabel}>Ask Ano for a canvas</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, gap: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  back: { height: 44, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLabel: { fontSize: 17, lineHeight: 22, color: colors.accent },
  pressed: { opacity: 0.7 },
  titleBlock: { gap: 4 },
  title: { fontFamily: fonts.rounded, fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.3, color: colors.ink },
  hint: { fontSize: 13, lineHeight: 16, color: colors.inkSecondary },
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  spacer: { flex: 1 },
  empty: { backgroundColor: colors.white, borderRadius: radii.card, padding: 20, gap: 10, ...shadows.card },
  emptyTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink },
  emptyText: { fontSize: 15, lineHeight: 21, color: colors.inkSecondary },
  askButton: { alignSelf: 'flex-start', marginTop: 6, height: 44, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  askLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.white },
});
