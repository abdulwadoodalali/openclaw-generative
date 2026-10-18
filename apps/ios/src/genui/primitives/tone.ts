// Tone to token maps. Class names are written out in full so NativeWind can see them.
import { colors } from '@/theme';
import type { Tone } from '../types.ts';

/** Small text on light backgrounds (AA contrast variants). */
export const TEXT_TONE_CLASS: Record<Tone, string> = {
  default: 'text-foreground',
  accent: 'text-amber-text',
  household: 'text-sage-text',
  muted: 'text-ink-secondary',
  danger: 'text-destructive',
};

/** Large numerals, where the plain accent colors have enough contrast (design/Chat.dc.html). */
export const NUMERAL_TONE_CLASS: Record<Tone, string> = {
  default: 'text-foreground',
  accent: 'text-amber',
  household: 'text-sage',
  muted: 'text-ink-secondary',
  danger: 'text-destructive',
};

/** Raw colors for SVG strokes and fills. */
export const TONE_COLOR: Record<Tone, string> = {
  default: colors.ink,
  accent: colors.accent,
  household: colors.household,
  muted: colors.inkSecondary,
  danger: colors.danger,
};

export const CARD_TONE_CLASS: Record<Tone, string> = {
  default: 'bg-card',
  accent: 'bg-amber-tint',
  household: 'bg-sage-tint',
  muted: 'bg-secondary',
  danger: 'bg-card border border-destructive',
};
