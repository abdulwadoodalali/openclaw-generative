// The models a canvas can run on, from the gateway's `models.list` (works with operator.read).
// Cached in memory for a few minutes. Pure TypeScript.
import type { RequestFn } from '../openclaw/sessionsApi.ts';
import { isPlainObject } from './types.ts';

export type ModelOption = {
  /** "<provider>/<id>", the value `sessions.patch` and CanvasAgent.model use. */
  ref: string;
  /** Display name, e.g. "Gemini 3.8 Flash". */
  label: string;
  provider: string;
  available: boolean;
};

export const MODELS_CACHE_MS = 5 * 60 * 1000;

let cache: { at: number; models: ModelOption[] } | null = null;
let inflight: Promise<ModelOption[]> | null = null;

function parseModels(result: unknown): ModelOption[] {
  const list = isPlainObject(result) ? result.models : undefined;
  if (!Array.isArray(list)) return [];
  const models: ModelOption[] = [];
  for (const row of list) {
    if (!isPlainObject(row)) continue;
    const { id, name, provider, available } = row;
    if (typeof id !== 'string' || !id || typeof provider !== 'string' || !provider) continue;
    models.push({
      ref: `${provider}/${id}`,
      label: typeof name === 'string' && name.trim() ? name.trim() : id,
      provider,
      available: available !== false,
    });
  }
  return models;
}

/** The gateway's models (cached for 5 minutes; concurrent callers share one request). A failed request is not cached. */
export function loadModels(request: RequestFn, now: () => number = Date.now): Promise<ModelOption[]> {
  if (cache && now() - cache.at < MODELS_CACHE_MS) return Promise.resolve(cache.models);
  if (inflight) return inflight;
  const pending = request('models.list', {})
    .then((result) => {
      const models = parseModels(result);
      cache = { at: now(), models };
      return models;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = pending;
  return pending;
}

/** A readable name for a model ref: the gateway's name once loaded, otherwise the id part of the ref. */
export function modelLabel(ref: string): string {
  const known = cache?.models.find((model) => model.ref === ref);
  if (known) return known.label;
  const slash = ref.indexOf('/');
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

/** Forgets the cached models (tests, switching gateways). */
export function clearModelsCache(): void {
  cache = null;
  inflight = null;
}
