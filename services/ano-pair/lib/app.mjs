// HTTP handler for ano-pair. Framework-free. Dependencies are injected so tests can fake them.
import crypto from 'node:crypto';
import { SlidingWindowLimiter } from './ratelimit.mjs';
import { normalizeIp } from './identity.mjs';
import { CONTRACT_VERSION, SERVICE_VERSION } from './config.mjs';

const MAX_BODY = 4096;
const HEX64 = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

function send(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(data);
}
const fail = (res, status, code, message, extra) => {
  if (status === 413) {
    res.on('finish', () => res.socket?.destroy());
    extra = { ...extra, connection: 'close' };
  }
  send(res, status, { ok: false, error: { code, message } }, extra);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Stop buffering; the 413 response closes the connection (see fail()).
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Validate and normalise the POST /pair body. Returns { value } or { error }. */
export function validatePairBody(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'body must be a JSON object' };
  const { deviceId, publicKey } = b;
  if (typeof deviceId !== 'string' || !HEX64.test(deviceId)) return { error: 'deviceId must be 64 lowercase hex chars' };
  if (typeof publicKey !== 'string' || !B64URL.test(publicKey) || publicKey.length > 64) return { error: 'publicKey must be base64url' };
  const raw = Buffer.from(publicKey, 'base64url');
  if (raw.length !== 32) return { error: 'publicKey must be a raw 32 byte Ed25519 key' };
  if (crypto.createHash('sha256').update(raw).digest('hex') !== deviceId) return { error: 'deviceId is not sha256(publicKey)', code: 'device_id_mismatch' };
  const platform = typeof b.platform === 'string' ? b.platform.trim().toLowerCase() : '';
  if (!/^(ios|ipados)$/.test(platform)) return { error: 'platform must be ios or ipados', code: 'unsupported_platform' };
  let displayName = typeof b.displayName === 'string' ? b.displayName : 'Ano iPhone';
  displayName = displayName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 64) || 'Ano iPhone';
  return { value: { deviceId, publicKey, platform, displayName } };
}

export function createApp({ config, identityProvider, issuer, audit, now = () => Date.now() }) {
  const ipLimiter = new SlidingWindowLimiter({ ...config.limits.ip, now });
  const deviceLimiter = new SlidingWindowLimiter({ ...config.limits.device, now });
  const globalLimiter = new SlidingWindowLimiter({ ...config.limits.global, now });
  const allowedHosts = new Set(config.allowedHosts);
  const corsOrigins = new Set(config.corsOrigins);

  const hostOf = (h) => {
    if (!h) return '';
    const s = h.toLowerCase();
    return s.startsWith('[') ? s.slice(0, s.indexOf(']') + 1) : s.split(':')[0];
  };

  return async function handle(req, res) {
    const ip = normalizeIp(req.socket.remoteAddress);
    try {
      const host = hostOf(req.headers.host);
      if (!allowedHosts.has(host)) return fail(res, 400, 'bad_host', 'unexpected Host header');

      // Browsers: blocked unless the origin is explicitly allowlisted (dev web only).
      const origin = req.headers.origin;
      const cors = {};
      if (origin !== undefined) {
        if (!corsOrigins.has(origin)) return fail(res, 403, 'origin_forbidden', 'browser origins are not allowed');
        cors['access-control-allow-origin'] = origin;
        cors.vary = 'Origin';
      }
      const url = new URL(req.url, 'http://x');

      if (req.method === 'OPTIONS' && origin !== undefined) {
        res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' });
        return res.end();
      }

      if (req.method === 'GET' && url.pathname === '/.well-known/ano') {
        const hostHeader = req.headers.host;
        return send(res, 200, {
          service: 'ano-pair',
          version: CONTRACT_VERSION,
          serviceVersion: SERVICE_VERSION,
          gatewayUrl: config.gatewayUrl,
          pairUrl: `http://${hostHeader.includes(':') && !hostHeader.endsWith(']') ? hostHeader : `${hostHeader}:${config.port}`}/pair`,
          identityProvider: identityProvider.name,
        }, cors);
      }

      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true }, cors);

      if (url.pathname === '/pair') {
        if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'use POST', { allow: 'POST', ...cors });
        return await handlePair(req, res, ip, cors);
      }
      return fail(res, 404, 'not_found', 'not found', cors);
    } catch (e) {
      if (e?.status === 413) return fail(res, 413, 'too_large', 'request body too large');
      audit.write('server.error', { ip, reason: e?.code || e?.message?.slice(0, 80) || 'error' });
      if (!res.headersSent) fail(res, 500, 'internal', 'internal error');
    }
  };

  async function handlePair(req, res, ip, cors) {
    const lim = ipLimiter.take(ip);
    if (!lim.ok) {
      audit.write('pair.rate_limited', { ip, limit: 'ip', retryAfterMs: lim.retryAfterMs });
      return fail(res, 429, 'rate_limited', 'too many requests', { 'retry-after': String(Math.ceil(lim.retryAfterMs / 1000)), ...cors });
    }
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return fail(res, 415, 'unsupported_media_type', 'use application/json', cors);

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (e) {
      if (e?.status === 413) return fail(res, 413, 'too_large', 'request body too large', cors);
      return fail(res, 400, 'bad_json', 'invalid JSON', cors);
    }
    const v = validatePairBody(parsed);
    if (v.error) {
      audit.write('pair.invalid', { ip, reason: v.error, code: v.code });
      return fail(res, 400, v.code || 'bad_request', v.error, cors);
    }
    const { deviceId, platform, displayName } = v.value;

    const auth = await identityProvider.authenticate({
      remoteAddress: req.socket.remoteAddress,
      headers: req.headers,
      body: parsed,
    });
    if (!auth.ok) {
      audit.write('pair.denied', { ip, deviceId, provider: identityProvider.name, code: auth.code, reason: auth.reason });
      const status = auth.code === 'unauthenticated' ? 401 : auth.code === 'unavailable' ? 503 : 403;
      return fail(res, status, auth.code, 'identity not accepted', cors);
    }
    const { identity } = auth;

    for (const [name, limiter, key] of [['device', deviceLimiter, deviceId], ['global', globalLimiter, '*']]) {
      const r = limiter.take(key);
      if (!r.ok) {
        audit.write('pair.rate_limited', { ip, deviceId, login: identity.login, limit: name, retryAfterMs: r.retryAfterMs });
        return fail(res, 429, 'rate_limited', 'too many pairing attempts', { 'retry-after': String(Math.ceil(r.retryAfterMs / 1000)), ...cors });
      }
    }

    let cred;
    try {
      cred = await issuer.issue({ deviceId });
    } catch (e) {
      audit.write('pair.error', { ip, deviceId, login: identity.login, reason: 'mint_failed', exitCode: e?.exitCode });
      return fail(res, 502, 'mint_failed', 'could not issue a credential, try again shortly', cors);
    }

    const issueId = crypto.randomUUID();
    audit.write('pair.issued', {
      ip, deviceId, login: identity.login, provider: identity.provider, issueId,
      expiresAtMs: cred.expiresAtMs, platform, displayName,
    });
    return send(res, 200, {
      ok: true,
      version: CONTRACT_VERSION,
      issueId,
      gatewayUrl: cred.gatewayUrl,
      bootstrapToken: cred.bootstrapToken,
      expiresAtMs: cred.expiresAtMs,
      identity: { provider: identity.provider, login: identity.login, displayName: identity.displayName },
      // How the app must redeem the token (see PAIRING.md).
      redeem: {
        auth: 'bootstrapToken',
        role: 'node',
        scopes: [],
        clientId: 'openclaw-ios',
        clientMode: 'node',
        platform,
        deviceFamily: platform === 'ipados' ? 'ipad' : 'iphone',
        minProtocol: 4,
        maxProtocol: 4,
        thenOperator: { role: 'operator', scopes: ['operator.read', 'operator.write'], clientMode: 'ui' },
      },
    }, cors);
  }
}
