// Bar drawing for Chart (kind "bar"): rounded bars on a shared zero baseline, an optional faint
// track per bar (its `max`) and the dashed budget line. Draws at an explicit pixel width.
import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { BAR_INSET, referenceY, type ValueRange } from './paths.ts';
import { REFERENCE_COLOR, type ToneColors } from './tone.ts';

export type BarDatum = { value: number; max?: number };

export type BarsProps = {
  bars: BarDatum[];
  width: number;
  height: number;
  tone: ToneColors;
  budgetLine?: number;
  /** Selected bar is drawn solid, the others at reduced opacity. Null: all solid. */
  selectedIndex: number | null;
};

/** Value range for bars: always includes zero, tracks and the budget line. */
export function barRange(bars: BarDatum[], budgetLine?: number): ValueRange {
  let min = 0;
  let max = 0;
  for (const bar of bars) {
    min = Math.min(min, bar.value);
    max = Math.max(max, bar.value, bar.max ?? 0);
  }
  if (budgetLine !== undefined) {
    min = Math.min(min, budgetLine);
    max = Math.max(max, budgetLine);
  }
  return max === min ? { min, max: min + 1 } : { min, max };
}

export function Bars({ bars, width, height, tone, budgetLine, selectedIndex }: BarsProps) {
  const layout = useMemo(() => {
    const range = barRange(bars, budgetLine);
    const y = (value: number) => referenceY(value, height, range, BAR_INSET);
    const slot = width / Math.max(1, bars.length);
    const barWidth = Math.min(44, Math.max(4, slot * 0.6));
    const zeroY = y(0);
    return {
      slot,
      barWidth,
      zeroY,
      cells: bars.map((bar, i) => {
        const x = i * slot + (slot - barWidth) / 2;
        const top = Math.min(y(bar.value), zeroY);
        const trackTop = bar.max === undefined ? undefined : y(bar.max);
        return { x, top, barHeight: Math.max(2, Math.abs(y(bar.value) - zeroY)), trackTop };
      }),
      budgetY: budgetLine === undefined ? undefined : y(budgetLine),
    };
  }, [bars, width, height, budgetLine]);

  return (
    <Svg width={width} height={height}>
      {layout.cells.map((cell, i) => (
        <React.Fragment key={i}>
          {cell.trackTop !== undefined && (
            <Rect
              x={cell.x}
              y={cell.trackTop}
              width={layout.barWidth}
              height={Math.max(0, layout.zeroY - cell.trackTop)}
              rx={5}
              fill={tone.tint}
              fillOpacity={tone.tintOpacity}
            />
          )}
          <Rect
            x={cell.x}
            y={cell.top}
            width={layout.barWidth}
            height={cell.barHeight}
            rx={5}
            fill={tone.line}
            fillOpacity={selectedIndex === null || selectedIndex === i ? 1 : 0.45}
          />
        </React.Fragment>
      ))}
      {layout.budgetY !== undefined && (
        <Path
          d={`M 0 ${layout.budgetY} L ${width} ${layout.budgetY}`}
          stroke={REFERENCE_COLOR}
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeDasharray="4 5"
          fill="none"
        />
      )}
    </Svg>
  );
}
