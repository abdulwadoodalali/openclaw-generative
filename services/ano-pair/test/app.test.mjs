import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeIssuer, FakeProvider, newDevice, post, startTestServer } from './helpers.mjs';

const body = (d, extra = {}) => ({ ...d, displayName: 'Alex iPhone', platform: 'ios', ...extra });

test('GET /.well-known/ano returns gateway url, pairUrl and version, no secrets', async () => {
  const t = await startTestServer();
  const r = await fetch(`${t.base}/.well-known/ano`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.gatewayUrl, 'wss://my-mac.example-tailnet.ts.net');
  assert.equal(j.version, 1);
  assert.equal(j.pairUrl, `http://127.0.0.1:${t.port}/pair`);
  assert.deepEqual(Object.keys(j).sort(), ['gatewayUrl', 'identityProvider', 'pairUrl', 'service', 'serviceVersion', 'version']);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  await t.close();
});

test('POST /pair issues a bootstrap credential tied to the deviceId', async () => {
  const t = await startTestServer();
  const d = newDevice();
  const r = await post(t.base, '/pair', body(d));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.match(j.bootstrapToken, /^FAKE-BOOTSTRAP-/);
  assert.equal(j.gatewayUrl, 'wss://gw.test');
  assert.equal(j.redeem.role, 'node');
  assert.deepEqual(j.redeem.scopes, []);
  assert.equal(j.redeem.clientId, 'openclaw-ios');
  assert.equal(j.redeem.deviceFamily, 'iphone');
  assert.deepEqual(t.issuer.calls, [{ deviceId: d.deviceId }]);
  const issued = t.records.find((x) => x.event === 'pair.issued');
  assert.equal(issued.deviceId, d.deviceId);
  assert.equal(issued.issueId, j.issueId);
  await t.close();
});

test('audit log never contains the credential or any secret-shaped field', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anopair-')), 'audit.log');
  const t = await startTestServer({ auditFile: f });
  const d = newDevice();
  const j = await (await post(t.base, '/pair', body(d))).json();
  const text = fs.readFileSync(f, 'utf8');
  assert.ok(text.includes(d.deviceId));
  assert.ok(!text.includes(j.bootstrapToken));
  assert.ok(!/token|secret|setupCode/i.test(text));
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  await t.close();
  fs.rmSync(path.dirname(f), { recursive: true });
});

test('identity denied -> 403 and no credential minted', async () => {
  const provider = new FakeProvider({ ok: false, code: 'forbidden', reason: 'login not allowed' });
  const t = await startTestServer({ provider });
  const r = await post(t.base, '/pair', body(newDevice()));
  assert.equal(r.status, 403);
  assert.equal(t.issuer.calls.length, 0);
  assert.ok(t.records.some((x) => x.event === 'pair.denied' && x.reason === 'login not allowed'));
  await t.close();
});

test('provider unavailable -> 503, unauthenticated -> 401', async () => {
  let t = await startTestServer({ provider: new FakeProvider({ ok: false, code: 'unavailable', reason: 'x' }) });
  assert.equal((await post(t.base, '/pair', body(newDevice()))).status, 503);
  await t.close();
  t = await startTestServer({ provider: new FakeProvider({ ok: false, code: 'unauthenticated', reason: 'x' }) });
  assert.equal((await post(t.base, '/pair', body(newDevice()))).status, 401);
  await t.close();
});

test('body validation', async () => {
  const t = await startTestServer();
  const d = newDevice();
  const other = newDevice();
  for (const bad of [
    body(d, { deviceId: 'abc' }),
    body(d, { publicKey: '!!!' }),
    body(d, { deviceId: other.deviceId }), // id does not match key
    body(d, { platform: 'android' }),
    [],
    'not json',
  ]) {
    const r = await post(t.base, '/pair', bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(t.issuer.calls.length, 0);
  const r = await post(t.base, '/pair', body(d), { 'content-type': 'text/plain' });
  assert.equal(r.status, 415);
  const big = await post(t.base, '/pair', JSON.stringify({ ...body(d), displayName: 'x'.repeat(9000) }));
  assert.equal(big.status, 413);
  await t.close();
});

test('per-device rate limit', async () => {
  const t = await startTestServer({ env: { ANO_PAIR_LIMIT_DEVICE: '2' } });
  const d = newDevice();
  assert.equal((await post(t.base, '/pair', body(d))).status, 200);
  assert.equal((await post(t.base, '/pair', body(d))).status, 200);
  const r = await post(t.base, '/pair', body(d));
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal((await post(t.base, '/pair', body(newDevice()))).status, 200); // other device unaffected
  await t.close();
});

test('per-ip and global rate limits', async () => {
  let t = await startTestServer({ env: { ANO_PAIR_LIMIT_IP: '3' } });
  for (let i = 0; i < 3; i++) await post(t.base, '/pair', body(newDevice()));
  assert.equal((await post(t.base, '/pair', body(newDevice()))).status, 429);
  await t.close();
  t = await startTestServer({ env: { ANO_PAIR_LIMIT_GLOBAL: '2' } });
  await post(t.base, '/pair', body(newDevice()));
  await post(t.base, '/pair', body(newDevice()));
  assert.equal((await post(t.base, '/pair', body(newDevice()))).status, 429);
  await t.close();
});

test('mint failure -> 502 with no detail leaked', async () => {
  const issuer = new FakeIssuer();
  issuer.fail = true;
  const t = await startTestServer({ issuer });
  const r = await post(t.base, '/pair', body(newDevice()));
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(await r.json()).includes('boom'));
  await t.close();
});

test('bad Host header (DNS rebinding) and browser Origin are refused', async () => {
  const t = await startTestServer();
  const hostile = await new Promise((resolve) => {
    import('node:http').then(({ default: http }) => {
      const req = http.request({ host: '127.0.0.1', port: t.port, path: '/.well-known/ano', headers: { host: 'evil.example:4391' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.end();
    });
  });
  assert.equal(hostile, 400);
  const r = await post(t.base, '/pair', body(newDevice()), { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(t.issuer.calls.length, 0);
  await t.close();
});

test('allowlisted CORS origin gets headers', async () => {
  const t = await startTestServer({ env: { ANO_PAIR_CORS_ORIGINS: 'http://localhost:8081' } });
  const r = await fetch(`${t.base}/.well-known/ano`, { headers: { origin: 'http://localhost:8081' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  await t.close();
});

test('unknown route 404, wrong method 405', async () => {
  const t = await startTestServer();
  assert.equal((await fetch(`${t.base}/nope`)).status, 404);
  assert.equal((await fetch(`${t.base}/pair`)).status, 405);
  await t.close();
});
