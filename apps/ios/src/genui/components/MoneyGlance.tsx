// MoneyGlance: month, spent / left / cash numerals and a sparkline with a dashed budget line.
// The visual target is the card in design/Chat.dc.html.
import React from 'react';
import { View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { fonts } from '@/theme';
import type { CodeComponentProps } from '../types.ts';
import { CardHeader } from '../charts/CardHeader.tsx';
import { formatValue } from '../charts/format.ts';
import { moneyGlanceSchema, parseProps } from '../charts/schemas.ts';
import { SparkArea } from '../charts/SparkArea.tsx';
import { useWidth } from '../charts/useWidth.ts';
import { GenUiFallback } from './GenUiFallback.tsx';

const SPARK_HEIGHT = 112;

function Figure({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <View className="flex-1 gap-[2px]">
      <Text variant="caption">{label}</Text>
      <Text
        variant="stat"
        numberOfLines={1}
        adjustsFontSizeToFit
        className={accent ? 'text-amber' : undefined}
        style={{ fontFamily: fonts.rounded }}
      >
        {formatValue(value, 'money')}
      </Text>
    </View>
  );
}

export function MoneyGlance({ props }: CodeComponentProps) {
  const [width, onLayout] = useWidth();
  const parsed = parseProps(moneyGlanceSchema, props);
  if (!parsed.ok) return <GenUiFallback name="MoneyGlance" raw={parsed.raw} error={parsed.error} />;
  const { month, spent, left, cash, budgetLine, series, sample } = parsed.data;

  return (
    <Card className="w-full gap-[14px]">
      <CardHeader title={month} sample={sample} />
      <View className="flex-row gap-2">
        <Figure label="Spent" value={spent} />
        {left !== undefined && <Figure label="Left" value={left} accent />}
        {cash !== undefined && <Figure label="Cash" value={cash} />}
      </View>
      <View
        onLayout={onLayout}
        style={{ height: SPARK_HEIGHT }}
        accessibilityRole="image"
        accessibilityLabel={`Spending trend, ${series.length} points`}
      >
        {series.length === 0 ? (
          <View className="flex-1 items-center justify-center rounded-tile bg-secondary">
            <Text variant="caption">No data to chart</Text>
          </View>
        ) : (
          width > 0 && <SparkArea series={series} width={width} height={SPARK_HEIGHT} budgetLine={budgetLine} />
        )}
      </View>
    </Card>
  );
}
