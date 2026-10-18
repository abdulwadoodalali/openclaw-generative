// "How Ano thinks": the model and effort of a chat, in the words the composer chip and the brain sheet
// use. The pure rules (quick picks, outcome labels, effort copy) live in src/chat; this file adds the
// model list hook and the chip label.
import { useEffect, useState } from 'react';
import { loadModels, modelLabel, type ModelOption } from '../../canvas/models';
import { EFFORTS, type Effort } from '../../chat/effort';
import { quickPicks, type QuickPick } from '../../chat/models';
import type { ChatPrefs } from '../../chat/prefs';
import { useAno } from '../../state/AnoProvider';

/** "Claude Sonnet 5.5" or "Google: Gemini 3.8 Flash" -> "Sonnet 5.5" / "Gemini 3.8 Flash": the vendor adds nothing in a 32pt chip. */
export function shortModel(label: string): string {
  return label.replace(/^[A-Za-z]+:\s*/, '').replace(/^(claude|anthropic|google|openai)\s+/i, '').trim() || label;
}

export function effortLabel(effort: Effort): string {
  return EFFORTS.find((e) => e.value === effort)?.label ?? effort;
}

/** The quick pick the prefs match exactly, if any. */
export function matchingPick(picks: readonly QuickPick[], prefs: Pick<ChatPrefs, 'model' | 'effort'>): QuickPick | undefined {
  return picks.find((p) => p.model === prefs.model && p.effort === prefs.effort);
}

/** The chip text: Quick, Balanced or Deep; "Default" when nothing was chosen; else "Sonnet 5.5 · Max". */
export function chipLabel(picks: readonly QuickPick[], prefs: Pick<ChatPrefs, 'model' | 'effort'>, agentDefaultModel: string | null): string {
  const pick = matchingPick(picks, prefs);
  if (pick) return pick.label;
  if (prefs.model === null && prefs.effort === null) return 'Default';
  const model = prefs.model ?? agentDefaultModel;
  const parts = [model ? shortModel(modelLabel(model)) : null, prefs.effort ? effortLabel(prefs.effort) : null];
  return parts.filter(Boolean).join(' \u00B7 ') || 'Default';
}

/** The gateway's models (cached), empty until loaded or when the request fails. */
export function useModels(): ModelOption[] {
  const { gateway, connection } = useAno();
  const [models, setModels] = useState<ModelOption[]>([]);
  const ready = connection.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    let live = true;
    loadModels((m, p) => gateway.request(m, p))
      .then((list) => live && setModels(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [gateway, ready]);
  return models;
}

/** The quick picks for this agent, resolved against the available models. */
export function useQuickPicks(agentDefaultModel: string | null): { models: ModelOption[]; picks: QuickPick[] } {
  const models = useModels();
  return { models, picks: quickPicks(models, agentDefaultModel) };
}
