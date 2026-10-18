// Thinking effort levels the picker offers, mapped 1:1 to `sessions.patch { thinkingLevel }`.
// Pure (no react / react-native / expo imports).

export type Effort = 'off' | 'low' | 'medium' | 'high' | 'max';

export const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

/** The levels the picker shows. 'off' stays valid for the gateway but is not offered. */
export const VISIBLE_EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'max'];

const EFFORT_COPY: Record<Effort, string> = {
  off: 'No extra thinking',
  low: 'Quick and light',
  medium: 'Balanced thinking',
  high: 'Thinks it through',
  max: 'Most thorough, slowest, uses more of your limit',
};

/** One plain-language line for an effort. null = the agent's own setting. */
export function effortCopy(effort: Effort | null): string {
  return effort === null ? "The agent's own setting" : EFFORT_COPY[effort];
}

/** The app's effort for a gateway thinking level, or null (unset, or a level the picker does not offer). */
export function asEffort(value: unknown): Effort | null {
  return EFFORTS.find((e) => e.value === value)?.value ?? null;
}
