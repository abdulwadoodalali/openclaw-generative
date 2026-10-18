// Plain-language model labels and the three quick picks of the brain sheet. The model list itself is
// loaded in src/canvas/models.ts. Pure (no react / react-native / expo).
import type { ModelOption } from '../canvas/models.ts';
import type { Effort } from './effort.ts';

/** What a model is good for, by name. The first matching rule wins. */
const OUTCOMES: Array<[RegExp, string]> = [
  [/claude.*sonnet/i, 'Everyday, careful'],
  [/deepseek/i, 'Budget-friendly'],
  [/minimax/i, 'Fast drafts'],
  [/gemini.*flash/i, 'Fast'],
  [/gemini.*pro/i, 'Long documents'],
  [/kimi/i, 'Reasoning'],
  [/qwen/i, 'Multilingual'],
];

/** "Fast", "Reasoning", ... for a model ref ("<provider>/<id>"), or null for a model without a label. */
export function modelOutcome(ref: string): string | null {
  return OUTCOMES.find(([pattern]) => pattern.test(ref))?.[1] ?? null;
}

export type QuickPick = {
  id: 'quick' | 'balanced' | 'deep';
  label: 'Quick' | 'Balanced' | 'Deep';
  hint: string;
  /** "<provider>/<id>", or null = the agent's default model. */
  model: string | null;
  /** null = the agent's default effort. */
  effort: Effort | null;
};

const QUICK_MODELS = ['openrouter/google/gemini-3.8-flash', 'opencode-go/deepseek-v4-flash'];
const DEEP_MODELS = ['claude-cli/claude-sonnet-5-5', 'openrouter/anthropic/claude-sonnet-5.5', 'openrouter/google/gemini-3.1-pro-preview'];

/**
 * Quick, Balanced and Deep with their models resolved against what the gateway offers. A pick whose
 * model is unavailable is dropped: Balanced uses the agent's default model, so it only goes when that
 * model is listed as unavailable.
 */
export function quickPicks(models: readonly ModelOption[], agentDefaultModel: string | null): QuickPick[] {
  const available = (ref: string) => models.some((m) => m.ref === ref && m.available);
  const picks: QuickPick[] = [];

  const quick = QUICK_MODELS.find(available);
  if (quick) picks.push({ id: 'quick', label: 'Quick', hint: 'Fast answers', model: quick, effort: 'low' });

  // Balanced is simply "what the agent normally does" (its model and effort), so a fresh chat reads
  // Balanced and the tile shows as chosen.
  const defaultListed = agentDefaultModel !== null ? models.find((m) => m.ref === agentDefaultModel) : undefined;
  if (!defaultListed || defaultListed.available) {
    picks.push({ id: 'balanced', label: 'Balanced', hint: 'Everyday', model: null, effort: null });
  }

  const deep = DEEP_MODELS.find(available);
  if (deep) picks.push({ id: 'deep', label: 'Deep', hint: 'Hard problems', model: deep, effort: 'max' });

  return picks;
}
