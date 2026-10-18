// The Chart primitive of the generative UI layer: line, area and bar series drawn with
// react-native-svg. react-native-gifted-charts is NOT used: its package entry loads a gradient
// helper that throws at import time unless expo-linear-gradient is installed, and the design
// wants flat token colors anyway.
//
// Tap a point or bar to read its value; bars also report the tap through `onSelect`.
import React, { useMemo, useState } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { Text } from '@/components/ui';
import { fonts } from '@/theme';
import type { ChartPoint, ChartProps } from '../types.ts';
import { Bars } from './Bars.tsx';
import { formatValue } from './format.ts';
import { BAR_INSET, indexAtX, LINE_INSET } from './paths.ts';
import { SparkArea } from './SparkArea.tsx';
import { TONE_COLORS } from './tone.ts';
import { useWidth } from './useWidth.ts';

/** A chart point; `max` draws a faint track behind a bar (for example a category budget). */
export type ChartSeriesPoint = ChartPoint & { max?: number };

/** ChartProps plus tap reporting and per-bar tracks. Any ChartProps value is accepted as is. */
export type ChartViewProps = Omit<ChartProps, 'series'> & {
  series: Array<number | ChartSeriesPoint>;
  /** Called when a point or bar is tapped; `index` is into the finite-values-only series. */
  onSelect?: (point: ChartSeriesPoint, index: number) => void;
};

const DEFAULT_HEIGHT = 160;
const LABEL_ROW_HEIGHT = 18;

/** Keep finite points only; a series of bad numbers renders the empty state, never throws. */
export function normalizeSeries(series: ChartViewProps['series']): ChartSeriesPoint[] {
  const points: ChartSeriesPoint[] = [];
  for (const item of series) {
    if (typeof item === 'number') {
      if (Number.isFinite(item)) points.push({ value: item });
    } else if (item && typeof item === 'object' && Number.isFinite(item.value)) {
      points.push(item);
    }
  }
  return points;
}

export function Chart({ kind, series, budgetLine, height = DEFAULT_HEIGHT, tone = 'default', format, onSelect }: ChartViewProps) {
  const [width, onLayout] = useWidth();
  const [selected, setSelected] = useState<number | null>(null);
  const points = useMemo(() => normalizeSeries(series), [series]);
  const toneColors = TONE_COLORS[tone];
  const budget = budgetLine !== undefined && Number.isFinite(budgetLine) ? budgetLine : undefined;
  const isBar = kind === 'bar';
  const selectedIndex = selected !== null && selected < points.length ? selected : null;

  if (points.length === 0) {
    return (
      <View
        className="w-full items-center justify-center rounded-tile bg-secondary"
        style={{ height }}
        accessibilityRole="text"
        accessibilityLabel="No data to chart"
      >
        <Text variant="caption">No data to chart</Text>
      </View>
    );
  }

  const shown = selectedIndex ?? (isBar ? null : points.length - 1);
  const shownPoint = shown === null ? undefined : points[shown];
  const plotHeight = height - LABEL_ROW_HEIGHT * 2;
  const first = points[0];
  const last = points[points.length - 1];

  const handlePress = (event: GestureResponderEvent) => {
    if (width <= 0) return;
    const inset = isBar ? BAR_INSET : LINE_INSET;
    const index = indexAtX(event.nativeEvent.locationX, points.length, width, inset, isBar ? 'slot' : 'point');
    select(index);
  };

  const select = (index: number) => {
    const point = points[index];
    if (!point) return;
    setSelected(index);
    onSelect?.(point, index);
  };

  return (
    <View
      className="w-full"
      onLayout={onLayout}
      accessible={!isBar}
      accessibilityRole={isBar ? undefined : 'image'}
      accessibilityLabel={
        isBar
          ? undefined
          : `${kind === 'area' ? 'Area' : 'Line'} chart, ${points.length} points, latest ${formatValue(last?.value ?? 0, format)}` +
            (budget === undefined ? '' : `, budget ${formatValue(budget, format)}`)
      }
    >
      <View className="flex-row items-center justify-between" style={{ height: LABEL_ROW_HEIGHT }}>
        <Text variant="caption" numberOfLines={1} className="flex-1">
          {shownPoint?.label ?? ''}
        </Text>
        <Text
          numberOfLines={1}
          className="text-[15px] font-semibold leading-[18px] text-foreground"
          style={{ fontFamily: fonts.rounded }}
        >
          {shownPoint ? formatValue(shownPoint.value, format) : ''}
        </Text>
      </View>

      {width > 0 ? (
        <Pressable onPress={handlePress} accessible={false} style={{ width, height: plotHeight }}>
          <View pointerEvents="none">
            {isBar ? (
              <Bars
                bars={points}
                width={width}
                height={plotHeight}
                tone={toneColors}
                budgetLine={budget}
                selectedIndex={selectedIndex}
              />
            ) : (
              <SparkArea
                series={points.map((p) => p.value)}
                width={width}
                height={plotHeight}
                budgetLine={budget}
                color={toneColors.line}
                tint={toneColors.tint}
                tintOpacity={toneColors.tintOpacity}
                showArea={kind === 'area'}
                dotIndex={shown ?? undefined}
              />
            )}
          </View>
        </Pressable>
      ) : (
        <View style={{ height: plotHeight }} />
      )}

      {isBar ? (
        <View className="flex-row" style={{ height: LABEL_ROW_HEIGHT }}>
          {points.map((point, i) => (
            <Pressable
              key={i}
              onPress={() => select(i)}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`${point.label ?? `Bar ${i + 1}`}, ${formatValue(point.value, format)}`}
              accessibilityState={{ selected: selectedIndex === i }}
              className="flex-1 items-center justify-center"
            >
              <Text
                variant="caption"
                numberOfLines={1}
                className={selectedIndex === i ? 'text-[11px] font-semibold text-foreground' : 'text-[11px]'}
              >
                {point.label ?? ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View className="flex-row justify-between" style={{ height: LABEL_ROW_HEIGHT }}>
          <Text variant="caption" numberOfLines={1} className="text-[11px]">
            {first?.label ?? ''}
          </Text>
          <Text variant="caption" numberOfLines={1} className="text-[11px]">
            {last?.label ?? ''}
          </Text>
        </View>
      )}
    </View>
  );
}
