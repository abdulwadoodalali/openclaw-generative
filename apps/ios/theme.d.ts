export const colors: {
  bg: string; surface: string; surfaceSheet: string; fill: string; separator: string; border: string;
  inputBorder: string; composerBorder: string; ink: string; inkSecondary: string; inkTertiary: string;
  accent: string; accentText: string; accentTint: string; household: string; householdText: string;
  householdTint: string; danger: string; dangerTint: string; signal: string; toast: string; toastRaised: string; shadow: string; scrim: string; white: string;
};
type OrbStops = [string, string, string];
export const orb: { idle: OrbStops; thinking: OrbStops; streaming: OrbStops; working: OrbStops; error: OrbStops; offline: OrbStops };
export const radii: {
  card: number; group: number; tile: number; pill: number; sheet: number; bubble: number;
  bubbleTail: number; chip: number;
};
export const shadows: {
  card: { color: string; offsetY: number; opacity: number; radius: number; elevation: number };
  button: { color: string; offsetY: number; opacity: number; radius: number; elevation: number };
};
export const spacing: { touch: number; gutter: number };
