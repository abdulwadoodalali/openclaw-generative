// "Pinned canvases": a horizontal strip of 148x100 tiles that bleeds to the screen edges. Nothing
// shows when nothing is pinned (Canvases lives in the sidebar). Touch and hold opens the tile menu.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Canvas } from '../../canvas/types';
import { colors, type } from '../../theme';
import { CanvasTile } from '../CanvasTile';

export type PinnedStripProps = {
  canvases: readonly Canvas[];
  onOpen: (canvas: Canvas) => void;
  onMenu: (canvas: Canvas) => void;
  onSeeAll: () => void;
};

export function PinnedStrip({ canvases, onOpen, onMenu, onSeeAll }: PinnedStripProps) {
  if (canvases.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.label} accessibilityRole="header">
          Pinned canvases
        </Text>
        <Pressable onPress={onSeeAll} hitSlop={{ top: 14, bottom: 14, left: 12, right: 4 }} accessibilityRole="link" accessibilityLabel="See all canvases">
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        {canvases.map((canvas) => (
          <CanvasTile key={canvas.id} canvas={canvas} onPress={() => onOpen(canvas)} onLongPress={() => onMenu(canvas)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...type.label, color: colors.inkSecondary },
  link: { fontSize: 13, lineHeight: 16, fontWeight: '600', color: colors.accentText },
  scroll: { marginHorizontal: -16 },
  row: { gap: 12, paddingHorizontal: 16, paddingBottom: 6 },
});
