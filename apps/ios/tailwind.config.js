const { hairlineWidth } = require('nativewind/theme');
const { colors, radii } = require('./theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // shadcn / react-native-reusables semantic names mapped onto the Ano tokens.
      colors: {
        background: colors.bg,
        foreground: colors.ink,
        card: { DEFAULT: colors.surface, foreground: colors.ink },
        popover: { DEFAULT: colors.surfaceSheet, foreground: colors.ink },
        primary: { DEFAULT: colors.accent, foreground: colors.white },
        secondary: { DEFAULT: colors.fill, foreground: colors.ink },
        muted: { DEFAULT: colors.fill, foreground: colors.inkSecondary },
        accent: { DEFAULT: colors.accentTint, foreground: colors.accentText },
        destructive: { DEFAULT: colors.danger, foreground: colors.white },
        border: colors.border,
        input: colors.inputBorder,
        ring: colors.accent,
        // Ano names, for direct use (bg-paper, text-ink-secondary, ...).
        paper: colors.bg,
        sheet: colors.surfaceSheet,
        ink: { DEFAULT: colors.ink, secondary: colors.inkSecondary, tertiary: colors.inkTertiary },
        amber: { DEFAULT: colors.accent, text: colors.accentText, tint: colors.accentTint },
        sage: { DEFAULT: colors.household, text: colors.householdText, tint: colors.householdTint },
        signal: colors.signal,
        separator: colors.separator,
      },
      borderRadius: {
        card: radii.card + 'px',
        group: radii.group + 'px',
        tile: radii.tile + 'px',
        pill: radii.pill + 'px',
        sheet: radii.sheet + 'px',
        bubble: radii.bubble + 'px',
        chip: radii.chip + 'px',
      },
      borderWidth: { hairline: hairlineWidth() },
      fontFamily: {
        rounded: ['ui-rounded', 'System'],
      },
    },
  },
  plugins: [],
};
