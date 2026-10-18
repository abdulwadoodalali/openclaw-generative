#!/usr/bin/env node
// End-to-end pairing check with a THROWAWAY device identity (in memory only).
// Never uses the shared gateway token. Never prints tokens.
//
//   node scripts/e2e-pair.mjs [--base http://<tailnet-ip>:4391]   (default: http://$ANO_PAIR_TAILNET_IP:4391) [--ws ws://127.0.0.1:18789] [--cleanup]
//
// Flow (this is exactly what the app must implement, see PAIRING.md):
//   1. GET  <base>/.well-known/ano            -> gatewayUrl, pairUrl
//   2. POST pairUrl {deviceId, publicKey, displayName, platform}  -> bootstrapToken
//   3. connect as role=node, auth.bootstrapToken        -> hello-ok with auth.deviceTokens[operator]
//   4. reconnect as role=operator, auth.deviceToken     -> hello-ok, then agents.list
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', process.env.ANO_PAIR_BASE || (process.env.ANO_PAIR_TAILNET_IP ? `http://${process.env.ANO_PAIR_TAILNET_IP}:4391` : 'http://127.0.0.1:4391'));
const WS_OVERRIDE = opt('--ws', process.env.ANO_PAIR_WS);
const CLEANUP = args.includes('--cleanup');
const OPENCLAW = process.env.ANO_PAIR_OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';

const secrets = new Set();
const redact = (s) => { let o = String(s); for (const x of secrets) if (x) o = o.split(x).join('<REDACTED>'); return o; };
const log = (...a) => console.log(redact(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')));

// Throwaway Ed25519 identity. deviceId = sha256(raw public key) hex; publicKey = raw 32 bytes base64url.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
const ident = { deviceId: crypto.createHash('sha256').update(raw).digest('hex'), publicKey: raw.toString('base64url') };
const sign = (payload) => crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
log('throwaway deviceId:', ident.deviceId);

function wsConnect(url, buildConnect) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, 20000);
    let nextId = 1;
    const pending = new Map();
    const req = (method, params) => new Promise((res, rej) => {
      const id = String(nextId++);
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
    ws.addEventListener('message', async (ev) => {
      const f = JSON.parse(String(ev.data));
      if (f.type === 'event' && f.event === 'connect.challenge') {
        try {
          const hello = await req('connect', buildConnect(f.payload));
          clearTimeout(t);
          resolve({ hello, req, ws });
        } catch (e) { clearTimeout(t); try { ws.close(); } catch {} reject(e); }
      } else if (f.type === 'res') {
        const p = pending.get(f.id);
        if (!p) return;
        pending.delete(f.id);
        f.ok ? p.res(f.payload) : p.rej(Object.assign(new Error(f.error?.message || 'error'), { code: f.error?.code, details: f.error?.details }));
      }
    });
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('ws error')); });
    ws.addEventListener('close', (e) => { clearTimeout(t); reject(new Error(`ws closed ${e.code} ${e.reason || ''}`)); });
  });
}

function connectParams({ challenge, role, scopes, mode, auth, token, displayName }) {
  const client = { id: 'openclaw-ios', displayName, version: '0.0.1', platform: 'ios', deviceFamily: 'iphone', mode };
  const payload = ['v3', ident.deviceId, client.id, client.mode, role, scopes.join(','), String(challenge.ts), token, challenge.nonce, client.platform, client.deviceFamily].join('|');
  return {
    minProtocol: 4, maxProtocol: 4, client, role, scopes, caps: [], commands: [], permissions: {}, auth,
    locale: 'en-US', userAgent: 'ano-pair-e2e/0.1',
    device: { id: ident.deviceId, publicKey: ident.publicKey, signature: sign(payload), signedAt: challenge.ts, nonce: challenge.nonce },
  };
}

let exitCode = 0;
try {
  // 1. discovery
  const wk = await (await fetch(`${BASE}/.well-known/ano`)).json();
  log('discovery ->', { gatewayUrl: wk.gatewayUrl, pairUrl: wk.pairUrl, version: wk.version });

  // 2. pair
  const pr = await fetch(wk.pairUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...ident, displayName: 'ano-pair e2e (throwaway)', platform: 'ios' }),
  });
  const pj = await pr.json();
  if (!pr.ok) throw new Error(`pair failed ${pr.status} ${JSON.stringify(pj.error)}`);
  secrets.add(pj.bootstrapToken);
  log('pair ->', { status: pr.status, issueId: pj.issueId, expiresInSec: Math.round((pj.expiresAtMs - Date.now()) / 1000), identity: pj.identity, redeem: pj.redeem, hasBootstrapToken: !!pj.bootstrapToken });

  const wsUrl = WS_OVERRIDE || pj.gatewayUrl;
  log('gateway ws:', wsUrl);

  // 3. redeem the bootstrap token as a node-shaped connect
  const r = pj.redeem;
  const node = await wsConnect(wsUrl, (challenge) => connectParams({
    challenge, role: r.role, scopes: r.scopes, mode: r.clientMode, auth: { bootstrapToken: pj.bootstrapToken },
    token: pj.bootstrapToken, displayName: 'ano-pair e2e (throwaway)',
  }));
  const a = node.hello.auth || {};
  const opEntry = (a.deviceTokens || []).find((d) => d.role === 'operator');
  if (a.deviceToken) secrets.add(a.deviceToken);
  if (opEntry?.deviceToken) secrets.add(opEntry.deviceToken);
  log('redeem hello-ok ->', { type: node.hello.type, protocol: node.hello.protocol, authRole: a.role, authScopes: a.scopes, hasNodeDeviceToken: !!a.deviceToken, extraTokens: (a.deviceTokens || []).map((d) => ({ role: d.role, scopes: d.scopes })) });
  node.ws.close();
  if (!opEntry) throw new Error('no operator token in bootstrap handoff');

  // 4. operator reconnect with the operator device token only
  const op = await wsConnect(wsUrl, (challenge) => connectParams({
    challenge, role: 'operator', scopes: opEntry.scopes.filter((s) => ['operator.read', 'operator.write'].includes(s)), mode: 'ui',
    auth: { deviceToken: opEntry.deviceToken }, token: opEntry.deviceToken, displayName: 'ano-pair e2e (throwaway)',
  }));
  log('operator hello-ok ->', { type: op.hello.type, protocol: op.hello.protocol, role: op.hello.auth?.role, scopes: op.hello.auth?.scopes, server: op.hello.server?.version });
  try { const al = await op.req('agents.list', {}); log('agents.list ok ->', { count: al.agents?.length, defaultId: al.defaultId }); } catch (e) { log('agents.list failed', e.message, e.code); exitCode = 1; }
  try { await op.req('sessions.delete', { key: 'agent:main:nonexistent-e2e' }); } catch (e) { log('admin method refused as expected ->', e.code, e.message); }
  op.ws.close();
  log('E2E OK: hello-ok received without the shared gateway token');
} catch (e) {
  exitCode = 1;
  log('E2E FAILED:', e.message, e.code || '', e.details ? JSON.stringify(e.details).slice(0, 300) : '');
} finally {
  if (CLEANUP) {
    try {
      const out = execFileSync(OPENCLAW, ['devices', 'remove', ident.deviceId, '--json'], { encoding: 'utf8', timeout: 30000 });
      log('cleanup: devices remove ->', out.trim().slice(0, 200));
    } catch (e) { log('cleanup failed (run: openclaw devices remove', ident.deviceId, ')'); }
  } else {
    log('remove with: openclaw devices remove', ident.deviceId);
  }
}
process.exit(exitCode);
