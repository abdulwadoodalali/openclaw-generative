// A saved canvas as a tile (design/Home.dc.html "Pinned canvases", Library "CanvasTile"): white,
// radius 20, padding 14, title 15/20 semibold with the scope dot, and one real figure taken from the
// canvas content (a MoneyGlance "left" figure with its sparkline, a task count) or, when there is
// none, when it was last changed. Nothing here is invented: every figure comes from the blocks.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { isStale } from '../canvas/refresh';
import { isPlainObject, type Canvas, type CanvasBlock } from '../canvas/types';
import { useCanvasEditor } from '../canvas/useCanvasEditor';
import { OLD_AFTER_MS, updatedStamp, versionLabel } from '../lib/relativeTime';
import { visualForMode } from '../orb/orbMachine.ts';
import { colors, fonts, radii, shadows } from '../theme';
import { AnoOrb } from './AnoOrb';
import { LockIcon, PinIcon } from './CanvasIcons';

export type CanvasTileProps = {
  canvas: Canvas;
  onPress: () => void;
  onLongPress?: () => void;
  /** `home`: the 100px tile. `list`: taller, with the version line and pinned marker. */
  variant?: 'home' | 'list';
};

type Preview = { headline: string | null; series: number[] | null };

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function numbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return out.length >= 2 ? out : null;
}

/** Every block, including the ones nested in `children` (Collapsible, Card, Stack). */
function* walk(blocks: readonly unknown[]): Generator<CanvasBlock> {
  for (const b of blocks) {
    if (!isPlainObject(b) || typeof b.component !== 'string') continue;
    const props = isPlainObject(b.props) ? b.props : {};
    yield { component: b.component, props };
    if (Array.isArray(props.children)) yield* walk(props.children);
  }
}

/** The first figure worth showing on a tile, read from the blocks: money left, tasks done, or a stat. */
function canvasPreview(blocks: readonly CanvasBlock[]): Preview {
  let tasks = 0;
  let done = 0;
  let stat: string | null = null;
  for (const b of walk(blocks)) {
    const p = b.props;
    if (b.component === 'MoneyGlance' && typeof p.left === 'number' && Number.isFinite(p.left)) {
      return { headline: `${money(p.left)} left`, series: numbers(p.series) };
    }
    if (b.component === 'TaskList' && Array.isArray(p.tasks)) {
      tasks += p.tasks.length;
      done += p.tasks.filter((t) => isPlainObject(t) && t.done === true).length;
    }
    if (stat === null && b.component === 'StatRow' && Array.isArray(p.items) && isPlainObject(p.items[0])) {
      const { value, label } = p.items[0];
      if ((typeof value === 'string' || typeof value === 'number') && typeof label === 'string') stat = `${value} ${label.toLowerCase()}`;
    }
    if (stat === null && b.component === 'Stat' && (typeof p.value === 'string' || typeof p.value === 'number') && typeof p.label === 'string') {
      stat = `${p.value} ${p.label.toLowerCase()}`;
    }
  }
  // Short enough for the 148pt Home tile at 22pt.
  if (tasks > 0) return { headline: `${done}/${tasks} done`, series: null };
  return { headline: stat, series: null };
}

function Sparkline({ series }: { series: number[] }) {
  const w = 56;
  const h = 20;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const d = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = 2 + (1 - (v - min) / span) * (h - 4);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Path d={d} fill="none" stroke={colors.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CanvasTile({ canvas, onPress, onLongPress, variant = 'home' }: CanvasTileProps) {
  const preview = canvasPreview(canvas.blocks);
  const run = useCanvasEditor(canvas.id);
  const list = variant === 'list';
  const scopeLabel = canvas.scope === 'household' ? 'Household' : 'Just me';
  const dot = canvas.scope === 'household' ? colors.household : colors.accent;
  const meta = versionLabel(canvas.version, canvas.updatedBy, canvas.updatedAt);
  const refreshing = run.running && run.kind === 'refresh';
  const freshAt = Math.max(canvas.updatedAt, canvas.lastRefreshedAt ?? 0);
  const old = !refreshing && Date.now() - freshAt > OLD_AFTER_MS;
  const stale = !refreshing && canvas.blocks.length > 0 && isStale(canvas, Date.now());
  const state = [canvas.locked ? 'locked' : null, canvas.pinned ? 'pinned' : null, refreshing ? 'refreshing' : null, stale ? 'needs refresh' : null]
    .filter(Boolean)
    .join(', ');
  const scopeMarker = refreshing ? (
    <AnoOrb state={visualForMode(run.activity?.mode ?? 'working')} size={12} />
  ) : (
    <View style={[styles.dot, { backgroundColor: dot }]} />
  );

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${canvas.title}, ${scopeLabel}${state ? `, ${state}` : ''}. ${preview.headline ?? meta}`}
      accessibilityHint={onLongPress ? 'Long press for more options' : undefined}
      style={({ pressed }) => [styles.tile, list ? styles.tileList : styles.tileHome, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={list ? 2 : 1}>
          {canvas.title}
        </Text>
        <View style={styles.markers}>
          {list && canvas.locked ? <LockIcon size={13} color={colors.inkSecondary} strokeWidth={2.2} /> : null}
          {preview.series && !list ? (
            refreshing ? scopeMarker : <Sparkline series={preview.series} />
          ) : (
            <>
              {list && canvas.pinned ? <PinIcon size={13} color={colors.inkSecondary} strokeWidth={2.2} /> : null}
              {scopeMarker}
            </>
          )}
        </View>
      </View>
      <View style={styles.bottom}>
        {preview.headline ? <Text style={styles.headline} numberOfLines={1}>{preview.headline}</Text> : null}
        {list ? (
          <>
            <Text style={styles.metaSmall} numberOfLines={1}>
              {meta}
            </Text>
            {stale ? <Text style={styles.stale} numberOfLines={1}>Needs refresh</Text> : null}
          </>
        ) : (
          <Text style={[styles.stamp, old && styles.stampOld]} numberOfLines={1}>
            {updatedStamp(freshAt)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    padding: 14,
    borderRadius: radii.tile,
    backgroundColor: colors.white,
    justifyContent: 'space-between',
    ...shadows.button,
  },
  // `flex` lives on the list variant only: on the web `flex: 0` still left a 0% basis that let the
  // horizontal strip shrink the tile to a sliver.
  tileHome: { width: 148, height: 100, flexShrink: 0 },
  tileList: { flex: 1, minHeight: 116 },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flexShrink: 1, fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  markers: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { gap: 2 },
  headline: { fontFamily: fonts.rounded, fontSize: 22, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'], color: colors.ink },
  metaSmall: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
  stale: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.accentText },
  stamp: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], color: colors.inkSecondary },
  stampOld: { color: colors.accentText },
});
