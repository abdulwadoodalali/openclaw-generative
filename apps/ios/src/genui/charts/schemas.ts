// Zod schemas for the props of the code built-ins (MoneyGlance, LineChart, BarChart). The
// PropSchema twins the model sees live in ../builtins/codeMeta.ts; keep both in sync.
import { z } from 'zod';

const finite = z.number().finite();

/** A series entry: a bare number or {label?, value}. */
const seriesEntry = z.union([finite, z.object({ label: z.string().max(40).optional(), value: finite })]);
const series = z.array(seriesEntry).max(400);

const format = z.enum(['money', 'percent', 'number']);

export const RANGE_KEYS = ['1M', '3M', '1Y'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const moneyGlanceSchema = z.object({
  month: z.string().max(40),
  spent: finite,
  left: finite.optional(),
  cash: finite.optional(),
  budgetLine: finite.optional(),
  series: z.array(finite).max(400),
  sample: z.boolean().optional(),
});
export type MoneyGlanceProps = z.infer<typeof moneyGlanceSchema>;

export const lineChartSchema = z
  .object({
    title: z.string().max(80).optional(),
    format: format.optional(),
    ranges: z.object({ '1M': series.optional(), '3M': series.optional(), '1Y': series.optional() }).optional(),
    series: series.optional(),
    budgetLine: finite.optional(),
    sample: z.boolean().optional(),
  })
  .refine((p) => p.series !== undefined || (p.ranges !== undefined && RANGE_KEYS.some((k) => p.ranges?.[k] !== undefined)), {
    message: 'needs ranges or series',
  });
export type LineChartProps = z.infer<typeof lineChartSchema>;

export const barChartSchema = z.object({
  title: z.string().max(80).optional(),
  format: format.optional(),
  bars: z
    .array(z.object({ label: z.string().max(40), value: finite, max: finite.optional() }))
    .min(1)
    .max(60),
  sample: z.boolean().optional(),
});
export type BarChartProps = z.infer<typeof barChartSchema>;

export type ParsedProps<T> = { ok: true; data: T } | { ok: false; error: string; raw: string };

/** Validate untrusted props; on failure return a one-line reason and the props as JSON text. */
export function parseProps<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, props: unknown): ParsedProps<T> {
  const result = schema.safeParse(props);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  let raw = '';
  try {
    raw = JSON.stringify(props, null, 1) ?? '';
  } catch {
    raw = String(props);
  }
  return { ok: false, error: `${where}${issue?.message ?? 'invalid props'}`, raw: raw.slice(0, 1200) };
}
