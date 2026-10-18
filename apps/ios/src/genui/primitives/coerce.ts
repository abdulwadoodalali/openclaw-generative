// Defensive readers for resolved node fields. Definitions come from the model, so every primitive
// treats its fields as untrusted `unknown` and falls back to a safe default instead of throwing.
// Pure TypeScript.
import { SPACING, TONES, type JsonObject, type JsonValue, type Tone } from '../types.ts';

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

export function asTone(value: unknown): Tone | undefined {
  return TONES.find((tone) => tone === value);
}

/** Snaps a number to the nearest step of the spacing scale; anything else gives `fallback`. */
export function snapSpacing(value: unknown, fallback: number): number {
  const n = asNumber(value);
  if (n === undefined) return fallback;
  return SPACING.reduce((best, step) => (Math.abs(step - n) < Math.abs(best - n) ? step : best), 0);
}

/** Resolved payloads may hold `undefined` (unbound props) or odd values; keep only JSON. */
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry) ?? null);
  if (typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      const json = toJsonValue(entry);
      if (json !== undefined && key !== '__proto__') out[key] = json;
    }
    return out;
  }
  return undefined;
}

export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);
  return json !== null && typeof json === 'object' && !Array.isArray(json) ? json : {};
}

/** A key usable for local view state: a plain identifier that is not a prototype name. */
export const STATE_KEY_RE = /^(?!__proto__$|constructor$|prototype$)[A-Za-z_][A-Za-z0-9_]*$/;
