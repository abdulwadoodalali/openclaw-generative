// POST /pair against the ano-pair service (PAIRING.md section 3). No react-native or expo imports.
// The bootstrap token returned here is a password: it lives in memory only, is never logged and is
// never part of an error message.
import { withTimeout, type DiscoveryDoc, type FetchLike } from './discovery.ts';

export const PAIR_TIMEOUT_MS = 50_000; // the service mints through the OpenClaw CLI (up to 45 s)
export const DEFAULT_RETRY_AFTER_MS = 30_000;
const MINT_RETRY_DELAY_MS = 3_000;

export type PairErrorCode =
  | 'rate_limited'
  | 'forbidden'
  | 'unauthenticated'
  | 'unavailable'
  | 'mint_failed'
  | 'bad_request'
  | 'bad_response'
  | 'network';

export class PairError extends Error {
  readonly code: PairErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(code: PairErrorCode, message: string, extra?: { status?: number; retryAfterMs?: number }) {
    super(message);
    this.name = 'PairError';
    this.code = code;
    this.status = extra?.status;
    this.retryAfterMs = extra?.retryAfterMs;
  }
}

export type RedeemShape = {
  role: string;
  scopes: string[];
  clientId: string;
  clientMode: string;
  platform: string;
  deviceFamily: string;
  minProtocol: number;
  maxProtocol: number;
};

export type PairGrant = {
  gatewayUrl: string;
  /** Secret. Memory only. */
  bootstrapToken: string;
  expiresAtMs: number;
  redeem: RedeemShape;
};

export type PairRequest = {
  deviceId: string;
  publicKey: string;
  displayName: string;
  platform: 'ios' | 'ipados';
};

/** The node-shaped connect that PAIRING.md section 4 mandates, used when the response omits `redeem`. */
export const DEFAULT_REDEEM: RedeemShape = {
  role: 'node',
  scopes: [],
  clientId: 'openclaw-ios',
  clientMode: 'node',
  platform: 'ios',
  deviceFamily: 'iphone',
  minProtocol: 4,
  maxProtocol: 4,
};

/** Retry-After as milliseconds: delta-seconds or an HTTP date. */
export function parseRetryAfterMs(value: string | null | undefined, now: () => number = Date.now): number {
  const v = value?.trim();
  if (!v) return DEFAULT_RETRY_AFTER_MS;
  if (/^\d+$/.test(v)) return Math.max(0, Number(v)) * 1000;
  const at = Date.parse(v);
  if (Number.isFinite(at)) return Math.max(0, at - now());
  return DEFAULT_RETRY_AFTER_MS;
}

// ---- single in-flight lock + 429 back-off (module state, one app process) -------------------------

let inflight: Promise<PairGrant> | null = null;
let blockedUntilMs = 0;

/** Test hook: forget the lock and the back-off window. */
export function resetPairState(): void {
  inflight = null;
  blockedUntilMs = 0;
}

function asRedeem(v: unknown): RedeemShape {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const str = (x: unknown, d: string) => (typeof x === 'string' && x ? x : d);
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    role: str(r.role, DEFAULT_REDEEM.role),
    scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [],
    clientId: str(r.clientId, DEFAULT_REDEEM.clientId),
    clientMode: str(r.clientMode, DEFAULT_REDEEM.clientMode),
    platform: str(r.platform, DEFAULT_REDEEM.platform),
    deviceFamily: str(r.deviceFamily, DEFAULT_REDEEM.deviceFamily),
    minProtocol: num(r.minProtocol, DEFAULT_REDEEM.minProtocol),
    maxProtocol: num(r.maxProtocol, DEFAULT_REDEEM.maxProtocol),
  };
}

async function postOnce(
  fetchFn: FetchLike,
  doc: DiscoveryDoc,
  req: PairRequest,
  now: () => number,
  timeoutMs: number,
): Promise<PairGrant> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let res;
  try {
    res = await withTimeout(
      fetchFn(doc.pairUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          deviceId: req.deviceId,
          publicKey: req.publicKey,
          displayName: req.displayName,
          platform: req.platform,
        }),
        signal: ctrl?.signal,
      }),
      timeoutMs,
      'pair request',
      () => ctrl?.abort(),
    );
  } catch {
    throw new PairError('network', 'Cannot reach the pairing service.');
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const errCode = typeof (body?.error as { code?: unknown } | undefined)?.code === 'string'
    ? ((body!.error as { code: string }).code)
    : undefined;

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'), now);
    blockedUntilMs = now() + retryAfterMs;
    throw new PairError('rate_limited', 'Pairing is rate limited. Try again shortly.', { status: 429, retryAfterMs });
  }
  if (res.status === 401) throw new PairError('unauthenticated', 'Sign in is required to pair.', { status: 401 });
  if (res.status === 403) throw new PairError('forbidden', 'This device is not allowed to pair.', { status: 403 });
  if (res.status === 502) throw new PairError('mint_failed', 'The Mac could not issue a pairing token.', { status: 502 });
  if (res.status === 503) throw new PairError('unavailable', 'The pairing service is unavailable.', { status: 503 });
  if (res.status >= 400 && res.status < 500) {
    throw new PairError('bad_request', `Pairing request rejected${errCode ? ` (${errCode})` : ''}.`, { status: res.status });
  }
  if (!res.ok || !body || body.ok !== true) {
    throw new PairError('bad_response', 'The pairing service sent an unexpected answer.', { status: res.status });
  }
  const token = body.bootstrapToken;
  const gatewayUrl = typeof body.gatewayUrl === 'string' && /^wss?:\/\//i.test(body.gatewayUrl) ? body.gatewayUrl : doc.gatewayUrl;
  if (typeof token !== 'string' || !token) {
    throw new PairError('bad_response', 'The pairing service sent no bootstrap token.', { status: res.status });
  }
  return {
    gatewayUrl,
    bootstrapToken: token,
    expiresAtMs: typeof body.expiresAtMs === 'number' ? body.expiresAtMs : now() + 10 * 60_000,
    redeem: asRedeem(body.redeem),
  };
}

/**
 * Ask the service for a bootstrap token. One request in flight at a time (concurrent callers share
 * it), a 429 closes the gate until Retry-After has passed (no request is sent meanwhile), and a 502
 * is retried once after a few seconds.
 */
export function requestBootstrap(
  fetchFn: FetchLike,
  doc: DiscoveryDoc,
  req: PairRequest,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
): Promise<PairGrant> {
  if (inflight) return inflight;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? PAIR_TIMEOUT_MS;
  if (now() < blockedUntilMs) {
    return Promise.reject(
      new PairError('rate_limited', 'Pairing is rate limited. Try again shortly.', { status: 429, retryAfterMs: blockedUntilMs - now() }),
    );
  }
  const run = (async () => {
    try {
      return await postOnce(fetchFn, doc, req, now, timeoutMs);
    } catch (e) {
      if (e instanceof PairError && e.code === 'mint_failed') {
        await sleep(MINT_RETRY_DELAY_MS);
        return await postOnce(fetchFn, doc, req, now, timeoutMs);
      }
      throw e;
    }
  })();
  inflight = run;
  const clear = () => {
    if (inflight === run) inflight = null;
  };
  run.then(clear, clear);
  return run;
}
