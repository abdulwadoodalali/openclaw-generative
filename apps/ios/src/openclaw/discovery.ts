// Finds the ano-pair service (see services/ano-pair/PAIRING.md section 2).
// No react-native or expo imports: the host injects fetch, so this runs under node --test.
import { ENV_PAIR_HOST } from '../env.ts';

export const PAIR_PORT = 4391;
export const KNOWN_DISCOVERY_VERSIONS: readonly number[] = [1];
export const PROBE_TIMEOUT_MS = 2000;

/** The slice of the fetch API this module uses. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type DiscoverySource = 'remembered' | 'dev-host' | 'magicdns';

export type DiscoveryDoc = {
  /** The base URL that answered, e.g. http://100.64.0.10:4391 (remembered for the next launch). */
  base: string;
  source: DiscoverySource;
  version: number;
  gatewayUrl: string;
  pairUrl: string;
};

export type Candidate = { source: DiscoverySource; base: string };

/** Host part of Expo's hostUri ("100.64.0.10:8083", "[fd7a::1]:8083", "mac.local"), or null. */
export function hostFromHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;
  let s = hostUri.trim();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.split(/[/?#]/)[0];
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) return null;
    const host = s.slice(1, end);
    return host ? `[${host}]` : null;
  }
  const colons = s.split(':').length - 1;
  // A bare IPv6 literal (several colons, no brackets) has no port to strip.
  if (colons > 1) return `[${s}]`;
  const host = colons === 1 ? s.slice(0, s.indexOf(':')) : s;
  return host || null;
}

/**
 * Candidate bases in discovery order (PAIRING.md step 2 and 3), the remembered one first.
 * `pairHost` (the Mac's MagicDNS name) defaults to EXPO_PUBLIC_ANO_PAIR_HOST; null skips it.
 */
export function candidateBases(opts: { hostUri?: string | null; rememberedBase?: string | null; pairHost?: string | null }): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (source: DiscoverySource, base: string | null | undefined) => {
    const b = base?.trim().replace(/\/+$/, '');
    if (!b || seen.has(b)) return;
    seen.add(b);
    out.push({ source, base: b });
  };
  add('remembered', opts.rememberedBase);
  const host = hostFromHostUri(opts.hostUri);
  if (host) add('dev-host', `http://${host}:${PAIR_PORT}`);
  const pairHost = opts.pairHost === undefined ? ENV_PAIR_HOST : opts.pairHost;
  if (pairHost) add('magicdns', `http://${pairHost}:${PAIR_PORT}`);
  return out;
}

/** Races a promise against a timer. The timer is always cleared. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v);
}
function isWsUrl(v: unknown): v is string {
  return typeof v === 'string' && /^wss?:\/\/[^\s]+$/i.test(v);
}

/** Probe one base. Returns the validated document or null (any failure, including an unknown version). */
export async function probe(fetchFn: FetchLike, cand: Candidate, timeoutMs = PROBE_TIMEOUT_MS): Promise<DiscoveryDoc | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  try {
    const res = await withTimeout(
      fetchFn(`${cand.base}/.well-known/ano`, { method: 'GET', headers: { accept: 'application/json' }, signal: ctrl?.signal }),
      timeoutMs,
      'discovery probe',
      () => ctrl?.abort(),
    );
    if (!res.ok || res.status !== 200) return null;
    const body = (await withTimeout(res.json(), timeoutMs, 'discovery body')) as Record<string, unknown> | null;
    if (!body || body.service !== 'ano-pair') return null;
    if (typeof body.version !== 'number' || !KNOWN_DISCOVERY_VERSIONS.includes(body.version)) return null;
    if (!isWsUrl(body.gatewayUrl) || !isHttpUrl(body.pairUrl)) return null;
    return { base: cand.base, source: cand.source, version: body.version, gatewayUrl: body.gatewayUrl, pairUrl: body.pairUrl };
  } catch {
    return null;
  }
}

/** Try the candidates in order, 2 s each, and return the first that answers with a known version. */
export async function discover(
  fetchFn: FetchLike,
  opts: { hostUri?: string | null; rememberedBase?: string | null; pairHost?: string | null; timeoutMs?: number },
): Promise<DiscoveryDoc | null> {
  for (const cand of candidateBases(opts)) {
    const doc = await probe(fetchFn, cand, opts.timeoutMs ?? PROBE_TIMEOUT_MS);
    if (doc) return doc;
  }
  return null;
}
