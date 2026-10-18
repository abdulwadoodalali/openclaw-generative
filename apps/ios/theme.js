// Single source of truth for the Ano design tokens (see ../../DESIGN.md).
// Plain CommonJS so tailwind.config.js (Node) and src/theme.ts (Metro) can both read it.
// No em-dashes, no gradients outside the orb and the composer scrim, cool-tinted shadows only.
//
// "Cobalt Desk": cool porcelain, near-black ink, one ultramarine. Moss covers household and success;
// vermilion is a signal reserved for the orb and never used for text. Contrast (WCAG 2.x):
// ink/bg 16.4, inkSecondary/bg 6.1, accent/bg 7.0, white/accent 7.8, inkTertiary/surface 3.2 (non-text).

const colors = {
  bg: '#F1F2F4', // porcelain, screen background
  surface: '#FFFFFF', // cards, input
  surfaceSheet: '#FAFBFC', // bottom sheets and the drawer
  fill: '#E6E8EC', // segmented track, quiet tags
  separator: '#E9EBEF', // list row dividers
  border: '#DDE0E6', // card borders
  inputBorder: '#D3D7DE',
  composerBorder: '#E1E4E9',
  ink: '#12141C', // primary text, dark buttons
  inkSecondary: '#565B68', // secondary text (6:1 on bg)
  inkTertiary: '#8C919D', // icons and chevrons (3:1 on surface), never text
  accent: '#2B3AD6', // ultramarine: user bubble, primary actions, links
  accentText: '#2230B4', // accent-colored text on light backgrounds
  accentTint: '#E7E9FB', // highlighted banners, chart area, action pills
  household: '#3E6B2F', // moss: household scope, success
  householdText: '#335A26',
  householdTint: '#E4EEDD',
  danger: '#B3261E',
  dangerTint: '#FBE9E7',
  signal: '#E8452C', // vermilion: the orb's done ring and "needs you" dot; decorative, never text
  toast: '#12141C', // dark toast and floating pills
  toastRaised: '#2A2E3B', // undo button on the dark toast
  shadow: '#141A33',
  scrim: 'rgba(20,26,51,0.32)', // sheet and sidebar backdrop (shadow at 32%)
  white: '#FFFFFF',
};

// Orb gradient stops per state: [highlight, body, rim]. Working uses the active agent's tone.
const orb = {
  idle: ['#F2F3FF', '#AEB6F2', '#7C86D9'],
  thinking: ['#F3F4FF', '#5B67F0', '#2B3AD6'],
  streaming: ['#FFFFFF', '#4655F5', '#1A27A8'],
  working: ['#F1F6EE', '#7FA36F', '#3E6B2F'],
  error: ['#FDECEA', '#E0655C', '#B3261E'],
  offline: ['#F4F5F7', '#C3C7CF', '#8C919D'],
};

const radii = {
  card: 22,
  group: 18,
  tile: 20,
  pill: 22, // 44px tall pills and inputs
  sheet: 32, // sheet top corners
  bubble: 20,
  bubbleTail: 6,
  chip: 6,
};

const shadows = {
  card: { color: colors.shadow, offsetY: 4, opacity: 0.07, radius: 16, elevation: 4 },
  button: { color: colors.shadow, offsetY: 1, opacity: 0.07, radius: 2, elevation: 1 },
};

const spacing = { touch: 44, gutter: 16 };

module.exports = { colors, orb, radii, shadows, spacing };
