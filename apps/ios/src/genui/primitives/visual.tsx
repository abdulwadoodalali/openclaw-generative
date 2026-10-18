// Progress (bar or ring) and the Chart primitive (drawn by ../charts/Chart).
import * as React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from '@/components/ui';
import { colors } from '@/theme';
import { Chart } from '../charts/Chart';
import type { ChartPoint } from '../types.ts';
import { asEnum, asNumber, asTone } from './coerce.ts';
import { TONE_COLOR } from './tone.ts';
import type { PrimitiveProps } from './types.ts';

const RING_STROKE = 7;
const MAX_POINTS = 366;
const CHART_FORMATS = ['money', 'percent', 'number'] as const;

export function ProgressPrimitive({ fields }: PrimitiveProps) {
  const value = asNumber(fields.value) ?? 0;
  const max = asNumber(fields.max) ?? 100;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  // Past the maximum (overspent) reads as danger unless the definition picked a tone.
  const tone = asTone(fields.tone) ?? (max > 0 && value > max ? 'danger' : 'accent');
  const color = TONE_COLOR[tone];
  const a11y = { accessibilityRole: 'progressbar', accessibilityValue: { min: 0, max, now: value } } as const;

  if (fields.variant === 'ring') {
    const size = Math.min(120, Math.max(40, asNumber(fields.size) ?? 64));
    const radius = (size - RING_STROKE) / 2;
    const circumference = 2 * Math.PI * radius;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} {...a11y}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.fill} strokeWidth={RING_STROKE} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - ratio)}
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
        <View style={{ position: 'absolute' }}>
          <Text variant="secondary" className="font-semibold text-foreground">
            {`${Math.round(ratio * 100)}%`}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="h-2 w-full overflow-hidden rounded-full bg-secondary" {...a11y}>
      <View className="h-2 rounded-full" style={{ width: `${ratio * 100}%`, backgroundColor: color }} />
    </View>
  );
}

function toSeries(raw: unknown): Array<number | ChartPoint> {
  if (!Array.isArray(raw)) return [];
  const out: Array<number | ChartPoint> = [];
  for (const entry of raw.slice(0, MAX_POINTS)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out.push(entry);
    else if (entry !== null && typeof entry === 'object' && 'value' in entry && typeof entry.value === 'number' && Number.isFinite(entry.value)) {
      out.push('label' in entry && typeof entry.label === 'string' ? { label: entry.label, value: entry.value } : { value: entry.value });
    }
  }
  return out;
}

export function ChartPrimitive({ fields }: PrimitiveProps) {
  const height = asNumber(fields.height);
  return (
    <Chart
      kind={asEnum(fields.kind, ['line', 'area', 'bar'] as const, 'area')}
      series={toSeries(fields.series)}
      budgetLine={asNumber(fields.budgetLine)}
      height={height === undefined ? undefined : Math.min(320, Math.max(60, height))}
      tone={asTone(fields.tone)}
      format={CHART_FORMATS.find((format) => format === fields.format)}
    />
  );
}
