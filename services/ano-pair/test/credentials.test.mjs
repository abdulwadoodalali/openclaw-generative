import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenClawQrIssuer, parseQrJson } from '../lib/credentials.mjs';
import { SlidingWindowLimiter } from '../lib/ratelimit.mjs';

const code = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const good = (extra = {}) => JSON.stringify({
  setupCode: code({ url: 'wss://gw.test', bootstrapToken: 'T'.repeat(30), expiresAtMs: Date.now() + 600_000 }),
  gatewayUrl: 'wss://gw.test', access: 'limited', ...extra,
});

test('parseQrJson extracts token and expiry', () => {
  const r = parseQrJson(good());
  assert.equal(r.bootstrapToken, 'T'.repeat(30));
  assert.ok(r.expiresAtMs > Date.now());
});

test('parseQrJson refuses full-access codes, expired codes and garbage', () => {
  assert.throws(() => parseQrJson(good({ access: 'full' })), /non-limited/);
  const expired = JSON.stringify({ setupCode: code({ url: 'wss://x', bootstrapToken: 'T'.repeat(30), expiresAtMs: 1 }) });
  assert.throws(() => parseQrJson(expired), /expired/);
  assert.throws(() => parseQrJson('nope'));
  assert.throws(() => parseQrJson('{}'));
});

test('issuer runs openclaw qr with limited flags, serialises calls, passes a minimal env', async () => {
  const seen = [];
  let running = 0, maxRunning = 0;
  const exec = (bin, argv, opts, cb) => {
    seen.push({ bin, argv, env: opts.env });
    running++; maxRunning = Math.max(maxRunning, running);
    setTimeout(() => { running--; cb(null, good()); }, 10);
  };
  const issuer = new OpenClawQrIssuer({ bin: '/x/openclaw', gatewayUrl: 'wss://gw.test', exec, env: { HOME: '/h', PATH: '/p', OPENCLAW_GATEWAY_TOKEN: 'SHOULD-NOT-LEAK' } });
  const [a, b] = await Promise.all([issuer.issue({ deviceId: 'a' }), issuer.issue({ deviceId: 'b' })]);
  assert.equal(maxRunning, 1);
  assert.equal(a.gatewayUrl, 'wss://gw.test');
  assert.deepEqual(seen[0].argv, ['qr', '--json', '--limited', '--no-ascii', '--url', 'wss://gw.test']);
  assert.ok(!('OPENCLAW_GATEWAY_TOKEN' in seen[0].env));
  assert.ok(b.bootstrapToken);
});

test('issuer errors do not leak output', async () => {
  const exec = (b, a, o, cb) => cb(Object.assign(new Error('stderr has SECRET'), { code: 3 }), 'SECRET');
  const issuer = new OpenClawQrIssuer({ bin: 'x', gatewayUrl: 'wss://g', exec });
  await assert.rejects(issuer.issue({}), (e) => e.exitCode === 3 && !/SECRET/.test(e.message));
});

test('sliding window limiter', () => {
  let t = 0;
  const l = new SlidingWindowLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.ok(l.take('k').ok); assert.ok(l.take('k').ok);
  const r = l.take('k');
  assert.equal(r.ok, false); assert.equal(r.retryAfterMs, 1000);
  t = 1001;
  assert.ok(l.take('k').ok);
});
