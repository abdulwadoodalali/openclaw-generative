// LineChart: a titled area chart card with a 1M / 3M / 1Y switch. Picking a range is local view
// state; nothing is sent to the model.
import React, { useState } from 'react';
import { Card } from '@/components/ui';
import type { CodeComponentProps } from '../types.ts';
import { CardHeader } from '../charts/CardHeader.tsx';
import { Chart } from '../charts/Chart.tsx';
import { RangeSwitch } from '../charts/RangeSwitch.tsx';
import { lineChartSchema, parseProps, RANGE_KEYS, type RangeKey } from '../charts/schemas.ts';
import { GenUiFallback } from './GenUiFallback.tsx';

export function LineChartCard({ props }: CodeComponentProps) {
  const [chosen, setChosen] = useState<RangeKey | null>(null);
  const parsed = parseProps(lineChartSchema, props);
  if (!parsed.ok) return <GenUiFallback name="LineChart" raw={parsed.raw} error={parsed.error} />;
  const { title, format, ranges, series, budgetLine, sample } = parsed.data;

  const available = RANGE_KEYS.filter((key) => ranges?.[key] !== undefined);
  const active = chosen !== null && available.includes(chosen) ? chosen : available[0];
  const shown = (active !== undefined ? ranges?.[active] : undefined) ?? series ?? [];

  return (
    <Card className="w-full gap-[14px]">
      <CardHeader title={title} sample={sample} />
      <Chart kind="area" series={shown} budgetLine={budgetLine} format={format} height={190} />
      {available.length > 1 && active !== undefined && (
        <RangeSwitch
          options={available}
          value={active}
          onChange={(option) => setChosen(available.find((key) => key === option) ?? null)}
        />
      )}
    </Card>
  );
}
