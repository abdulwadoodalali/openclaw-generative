import crypto from 'node:crypto';
import http from 'node:http';
import { loadConfig } from '../lib/config.mjs';
import { AuditLog } from '../lib/audit.mjs';
import { createApp } from '../lib/app.mjs';

export function newDevice() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { deviceId: crypto.createHash('sha256').update(raw).digest('hex'), publicKey: raw.toString('base64url') };
}

export class FakeProvider {
  constructor(result) {
    this.name = 'fake';
    this.result = result ?? { ok: true, identity: { provider: 'fake', subject: '1', login: 'you@example.com', displayName: 'Alex' } };
    this.calls = [];
  }
  async authenticate(ctx) {
    this.calls.push(ctx);
    return typeof this.result === 'function' ? this.result(ctx) : this.result;
  }
}

export class FakeIssuer {
  constructor() {
    this.calls = [];
    this.fail = false;
  }
  async issue(args) {
    this.calls.push(args);
    if (this.fail) throw Object.assign(new Error('boom'), { exitCode: 1 });
    return { bootstrapToken: 'FAKE-BOOTSTRAP-' + 'x'.repeat(24), expiresAtMs: Date.now() + 600_000, gatewayUrl: 'wss://gw.test', access: 'limited' };
  }
}

export const TEST_ENV = { ANO_PAIR_TAILNET_IP: '100.64.0.10', ANO_PAIR_ALLOWED_LOGINS: 'you@example.com', ANO_PAIR_MAGICDNS: 'my-mac.example-tailnet.ts.net' };

export async function startTestServer({ provider = new FakeProvider(), issuer = new FakeIssuer(), env = {}, auditFile } = {}) {
  const config = loadConfig({ ...TEST_ENV, ANO_PAIR_BIND: '127.0.0.1', ANO_PAIR_RUN_DIR: '/nonexistent-unused', ...env });
  const records = [];
  const audit = new AuditLog({ file: auditFile });
  const origWrite = audit.write.bind(audit);
  audit.write = (e, f) => {
    const r = origWrite(e, f);
    records.push(r);
    return r;
  };
  const server = http.createServer(createApp({ config, identityProvider: provider, issuer, audit }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { server, base, port, provider, issuer, records, config, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}

export function post(base, path, body, headers = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
