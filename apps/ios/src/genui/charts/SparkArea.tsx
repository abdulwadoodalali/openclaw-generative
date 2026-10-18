// Own react-native-svg sparkline, the look of design/Chat.dc.html: thin amber line, soft tint
// area, dashed budget line and a ringed end dot. Draws at an explicit pixel width (measure with
// useWidth); no gradients, no extra packages.
import React, { useMemo } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/theme';
import { areaPath, LINE_INSET, linePath, referenceY, scalePoints, valueRange, type Inset } from './paths.ts';
import { REFERENCE_COLOR } from './tone.ts';

export type SparkAreaProps = {
  /** Finite values, oldest first. */
  series: number[];
  width: number;
  height: number;
  /** Dashed horizontal reference value on the same scale as the series. */
  budgetLine?: number;
  /** Line and dot color. Default: the amber accent. */
  color?: string;
  /** Area fill color. Default: the amber tint. */
  tint?: string;
  tintOpacity?: number;
  /** Draw the soft area under the line. Default true. */
  showArea?: boolean;
  /** Point carrying the ringed dot. Default: the last point. */
  dotIndex?: number;
  inset?: Inset;
};

export function SparkArea({
  series,
  width,
  height,
  budgetLine,
  color = colors.accent,
  tint = colors.accentTint,
  tintOpacity = 1,
  showArea = true,
  dotIndex,
  inset = LINE_INSET,
}: SparkAreaProps) {
  const geometry = useMemo(() => {
    const range = valueRange(series, budgetLine);
    const points = scalePoints(series, width, height, range, inset);
    return {
      points,
      line: linePath(points),
      area: areaPath(points, height),
      budgetY: budgetLine === undefined ? undefined : referenceY(budgetLine, height, range, inset),
    };
  }, [series, width, height, budgetLine, inset]);

  const dot = geometry.points[dotIndex ?? geometry.points.length - 1];

  return (
    <Svg width={width} height={height} style={{ overflow: 'visible' }}>
      {geometry.budgetY !== undefined && (
        <Path
          d={`M 0 ${geometry.budgetY} L ${width} ${geometry.budgetY}`}
          stroke={REFERENCE_COLOR}
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeDasharray="4 5"
          fill="none"
        />
      )}
      {showArea && geometry.points.length > 1 && (
        <Path d={geometry.area} fill={tint} fillOpacity={tintOpacity} stroke="none" />
      )}
      {geometry.points.length > 1 && (
        <Path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {dot && <Circle cx={dot.x} cy={dot.y} r={4.5} fill={colors.white} stroke={color} strokeWidth={2.5} />}
    </Svg>
  );
}
