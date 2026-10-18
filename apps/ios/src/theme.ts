// RN-facing view of the design tokens. The values live in ../theme.js (shared with Tailwind).
// Prefer NativeWind classes (bg-paper, text-ink-secondary, rounded-card); use these constants
// where a raw value is required (SVG strokes, shadows, TextInput placeholder colors).
import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { colors, orb as orbTokens, radii, shadows as shadowTokens, spacing } from '../theme';

export { colors, radii, spacing };
/** Orb gradient stops per state: [highlight, body, rim]. */
export const orbColors = orbTokens;
export const layout = { touch: spacing.touch, gutter: spacing.gutter } as const;

export type ColorName = keyof typeof colors;

export const fonts = {
  /** SF Pro (system font) for body and UI. */
  body: undefined as string | undefined,
  /** SF Pro Rounded for display numerals, titles and the avatar letter. */
  rounded: Platform.select({
    ios: 'ui-rounded',
    web: "ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif",
    default: undefined,
  }),
  /** SF Mono: instrument-like figures for stakes, times and section labels. */
  mono: Platform.select({ ios: 'ui-monospace', web: "ui-monospace, 'SF Mono', Menlo, monospace", default: 'monospace' }),
};

export const type: Record<'body' | 'bodyAssistant' | 'secondary' | 'caption' | 'title' | 'label', TextStyle> = {
  body: { fontSize: 16, lineHeight: 22 },
  bodyAssistant: { fontSize: 16, lineHeight: 23 },
  secondary: { fontSize: 13, lineHeight: 16 },
  caption: { fontSize: 12, lineHeight: 16 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  // Section labels are mono and sentence case. The tracked uppercase eyebrow is the generic AI look.
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 0,
    fontFamily: fonts.mono,
  },
};

function toShadow(t: (typeof shadowTokens)['card']): ViewStyle {
  return {
    shadowColor: t.color,
    shadowOffset: { width: 0, height: t.offsetY },
    shadowOpacity: t.opacity,
    shadowRadius: t.radius,
    elevation: t.elevation,
  };
}

export const shadows: Record<'card' | 'button', ViewStyle> = {
  card: toShadow(shadowTokens.card),
  button: toShadow(shadowTokens.button),
};
