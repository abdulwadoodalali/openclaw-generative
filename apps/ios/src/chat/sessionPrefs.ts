// Per-session model and thinking effort, written with `sessions.patch` (works with operator.write).
// `null` resets the field to the agent's own default. Pure (no react / react-native / expo).
import type { RequestFn } from '../openclaw/sessionsApi.ts';
import type { Effort } from './effort.ts';

/** The model and effort a session runs on. null = the agent's own default. */
export type SessionBrain = { model: string | null; effort: Effort | null };

/** `model` is "<provider>/<id>" (a ModelOption.ref), or null for the agent's default. */
export async function patchSessionModel(req: RequestFn, key: string, model: string | null): Promise<void> {
  await req('sessions.patch', { key, model });
}

/** `effort` is a thinking level, or null for the agent's default. Any level the gateway reports is accepted (restoring a chat keeps levels the picker does not offer). */
export async function patchSessionEffort(req: RequestFn, key: string, effort: string | null): Promise<void> {
  await req('sessions.patch', { key, thinkingLevel: effort });
}

/**
 * Puts a freshly created session on the chosen model and effort (null fields are left alone, a new
 * session already runs on the agent default). A field the gateway rejects stays at the default instead
 * of failing the chat: the result says what was actually applied.
 */
export async function applySessionPrefs(
  req: RequestFn,
  key: string,
  prefs: { model: string | null; effort: Effort | null },
): Promise<{ model: string | null; effort: Effort | null }> {
  const applied: { model: string | null; effort: Effort | null } = { model: null, effort: null };
  if (prefs.model !== null) {
    try {
      await patchSessionModel(req, key, prefs.model);
      applied.model = prefs.model;
    } catch {
      // keep the agent default
    }
  }
  if (prefs.effort !== null) {
    try {
      await patchSessionEffort(req, key, prefs.effort);
      applied.effort = prefs.effort;
    } catch {
      // keep the agent default
    }
  }
  return applied;
}
