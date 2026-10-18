// Shared geometry helpers for the generative UI charts (src/genui/charts/).
// Pure TypeScript: no react, react-native or expo imports, so Node can strip the types.

export type ScaledPoint = { x: number; y: number };

export type ValueRange = { min: number; max: number };

export type Inset = { top: number; right: number; bottom: number; left: number };

/**
 * Inclusive min/max of the finite values, optionally widened to include `extra` (a budget
 * reference), then padded by 8 percent so the stroke never hugs the SVG edge. A flat series
 * still gets a visible band around its value.
 */
export function valueRange(values: number[], extra?: number): ValueRange {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (extra !== undefined && Number.isFinite(extra)) {
    if (extra < min) min = extra;
    if (extra > max) max = extra;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Map series values to SVG coordinates, oldest first, y flipped for SVG space. */
export function scalePoints(
  values: number[],
  width: number,
  height: number,
  range: ValueRange,
  inset: Inset,
): ScaledPoint[] {
  const innerW = Math.max(1, width - inset.left - inset.right);
  const innerH = Math.max(1, height - inset.top - inset.bottom);
  const span = range.max - range.min || 1;
  const n = values.length;
  const step = n > 1 ? innerW / (n - 1) : 0;
  return values.map((v, i) => ({
    x: inset.left + (n > 1 ? i * step : innerW / 2),
    y: inset.top + innerH * (1 - (v - range.min) / span),
  }));
}

/** Y coordinate of a horizontal reference value under the same scale as scalePoints. */
export function referenceY(value: number, height: number, range: ValueRange, inset: Inset): number {
  const innerH = Math.max(1, height - inset.top - inset.bottom);
  const span = range.max - range.min || 1;
  return inset.top + innerH * (1 - (value - range.min) / span);
}

export function linePath(points: ScaledPoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round2(p.x)} ${round2(p.y)}`).join(' ');
}

/** Closed fill path under the line, down to `bottom` and back. */
export function areaPath(points: ScaledPoint[], bottom: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points)} L ${round2(last.x)} ${round2(bottom)} L ${round2(first.x)} ${round2(bottom)} Z`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Plot insets: line charts leave room for the ringed end dot, bars use the full width. */
export const LINE_INSET: Inset = { top: 8, right: 8, bottom: 6, left: 4 };
export const BAR_INSET: Inset = { top: 8, right: 0, bottom: 2, left: 0 };

/**
 * Index touched at horizontal position `x`. `point` snaps to the nearest of `count` evenly spaced
 * points (line charts); `slot` picks the equal-width column containing x (bar charts).
 */
export function indexAtX(x: number, count: number, width: number, inset: Inset, mode: 'point' | 'slot'): number {
  if (count <= 1) return 0;
  const innerW = Math.max(1, width - inset.left - inset.right);
  const t = Math.min(1, Math.max(0, (x - inset.left) / innerW));
  return mode === 'point' ? Math.round(t * (count - 1)) : Math.min(count - 1, Math.floor(t * count));
}
