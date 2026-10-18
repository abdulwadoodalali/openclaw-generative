// BarChart: labelled bars with optional per-bar max (a faint track, for example a category
// budget). Tapping a bar tells the model which one: action `select` with payload {label}.
import React from 'react';
import { Card } from '@/components/ui';
import type { CodeComponentProps } from '../types.ts';
import { CardHeader } from '../charts/CardHeader.tsx';
import { Chart } from '../charts/Chart.tsx';
import { barChartSchema, parseProps } from '../charts/schemas.ts';
import { GenUiFallback } from './GenUiFallback.tsx';

export function BarChartCard({ props, instanceId, onAction }: CodeComponentProps) {
  const parsed = parseProps(barChartSchema, props);
  if (!parsed.ok) return <GenUiFallback name="BarChart" raw={parsed.raw} error={parsed.error} />;
  const { title, format, bars, sample } = parsed.data;

  return (
    <Card className="w-full gap-[14px]">
      <CardHeader title={title} sample={sample} />
      <Chart
        kind="bar"
        series={bars}
        format={format}
        height={190}
        onSelect={(point) =>
          onAction({ component: 'BarChart', instanceId, name: 'select', payload: { label: point.label ?? '' } })
        }
      />
    </Card>
  );
}
