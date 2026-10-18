// Tone -> chart colors, from the design tokens. `default` is the amber accent: the chart line is
// the one accent on the screen (DESIGN.md).
import { colors } from '@/theme';
import type { Tone } from '../types.ts';

export type ToneColors = {
  /** Line, bar and end-dot color. */
  line: string;
  /** Soft area fill and bar track color. */
  tint: string;
  tintOpacity: number;
};

export const TONE_COLORS: Record<Tone, ToneColors> = {
  default: { line: colors.accent, tint: colors.accentTint, tintOpacity: 1 },
  accent: { line: colors.accent, tint: colors.accentTint, tintOpacity: 1 },
  household: { line: colors.household, tint: colors.householdTint, tintOpacity: 1 },
  muted: { line: colors.inkSecondary, tint: colors.fill, tintOpacity: 1 },
  danger: { line: colors.danger, tint: colors.danger, tintOpacity: 0.12 },
};

/** Dashed budget reference stroke. */
export const REFERENCE_COLOR = colors.inkTertiary;
