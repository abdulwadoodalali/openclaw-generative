// Chat preferences: the agent, model and effort of a chat. The defaults (what a new chat starts with)
// are persisted. Pure (no react / react-native / expo).
import { isPlainObject } from '../canvas/types.ts';
import { asEffort, type Effort } from './effort.ts';

/** `model` is "<provider>/<id>", null = the agent's default; `effort` null = the agent's default. */
export type ChatPrefs = { agentId: string; model: string | null; effort: Effort | null };

/** Reads the persisted defaults. Anything missing or malformed falls back to `fallbackAgentId` / "Default". */
export function parseChatPrefs(raw: string | null, fallbackAgentId: string): ChatPrefs {
  const fallback: ChatPrefs = { agentId: fallbackAgentId, model: null, effort: null };
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return fallback;
    const { agentId, model, effort } = parsed;
    return {
      agentId: typeof agentId === 'string' && agentId ? agentId : fallbackAgentId,
      model: typeof model === 'string' && model ? model : null,
      effort: asEffort(effort),
    };
  } catch {
    return fallback;
  }
}
