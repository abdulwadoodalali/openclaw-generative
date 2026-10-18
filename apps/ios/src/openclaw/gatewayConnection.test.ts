// @ts-nocheck
// Tests run under Node with --experimental-strip-types; no @types/node in this Expo project.
// Regression: a gateway restart (socket dying mid-handshake) must read as an outage, never as
// "Not authorised", and must never wipe the stored device token.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GatewayConnection } from './gatewayConnection.ts';

type Script = (ws: FakeSocket, frame: { id: string; method: string }) => void;

class FakeSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  script: Script;
  constructor(script: Script) {
    this.script = script;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
      this.emit({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n1', ts: Date.now() } });
    });
  }
  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  send(data: string) {
    const frame = JSON.parse(data);
    if (frame.method === 'connect') this.script(this, frame);
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

const helloOk = (id: string) => ({
  type: 'res',
  id,
  ok: true,
  payload: {
    type: 'hello-ok',
    protocol: 4,
    server: { version: 'test', connId: 'c1' },
    features: { methods: [], events: [] },
    snapshot: {},
    auth: { method: 'token', role: 'operator', scopes: ['operator.read', 'operator.write'], deviceToken: 'dev-token' },
    policy: { maxPayload: 1000000, maxBufferedBytes: 1000000, tickIntervalMs: 30000 },
  },
});

function makeConnection(scripts: Script[]) {
  let stored: { token: string; scopes: string[] } | null = { token: 'dev-token', scopes: ['operator.read', 'operator.write'] };
  let clears = 0;
  let n = 0;
  const conn = new GatewayConnection({
    createWebSocket: () => new FakeSocket(scripts[Math.min(n++, scripts.length - 1)]) as never,
    loadIdentity: async () => ({ deviceId: 'dev-1', publicKey: 'pk', sign: async () => 'sig' }),
    tokenStore: {
      load: async () => stored,
      store: async (r) => {
        stored = { token: r.token, scopes: r.scopes };
      },
      clear: async () => {
        clears++;
        stored = null;
      },
    },
    createId: () => `id-${Math.random().toString(36).slice(2)}`,
  });
  return { conn, getClears: () => clears, getStored: () => stored };
}

function waitFor(conn: GatewayConnection, pred: (s: string) => boolean, ms = 8000) {
  return new Promise<void>((resolve, reject) => {
    if (pred(conn.getInfo().status)) return resolve();
    const t = setTimeout(() => reject(new Error(`timeout, status ${conn.getInfo().status}`)), ms);
    const off = conn.subscribeStatus(() => {
      if (pred(conn.getInfo().status)) {
        clearTimeout(t);
        off();
        resolve();
      }
    });
  });
}

describe('GatewayConnection outages', () => {
  it('treats an unexplained connect failure as an outage and keeps the device token', async () => {
    const seen: string[] = [];
    const { conn, getClears, getStored } = makeConnection([
      // First attempt: a failure with no structured auth detail (gateway restarting, proxy hiccup).
      (ws, f) => ws.emit({ type: 'res', id: f.id, ok: false, error: { code: 'INTERNAL', message: 'something odd' } }),
      // Second attempt: back up.
      (ws, f) => ws.emit(helloOk(f.id)),
    ]);
    conn.subscribeStatus(() => seen.push(conn.getInfo().status));
    conn.start({ url: 'ws://fake' });
    await waitFor(conn, (s) => s === 'ready');
    conn.stop();
    assert.ok(!seen.includes('auth-failed'), `unexpected auth-failed in ${seen.join(',')}`);
    assert.equal(getClears(), 0);
    assert.equal(getStored()?.token, 'dev-token');
  });

  it('shows reconnecting (not auth-failed) when a ready connection drops and the retry is cut off', async () => {
    const seen: string[] = [];
    const { conn, getClears } = makeConnection([
      (ws, f) => {
        ws.emit(helloOk(f.id));
        setTimeout(() => ws.close(1006, ''), 20);
      },
      (ws) => ws.close(1006, ''),
      (ws, f) => ws.emit(helloOk(f.id)),
    ]);
    conn.subscribeStatus(() => seen.push(conn.getInfo().status));
    conn.start({ url: 'ws://fake' });
    await waitFor(conn, (s) => s === 'ready');
    await waitFor(conn, (s) => s === 'reconnecting');
    await waitFor(conn, (s) => s === 'ready');
    conn.stop();
    assert.ok(!seen.includes('auth-failed'), `unexpected auth-failed in ${seen.join(',')}`);
    assert.equal(getClears(), 0);
  });

  it('still reports a real device-token rejection and clears that token', async () => {
    const { conn, getClears } = makeConnection([
      (ws, f) =>
        ws.emit({
          type: 'res',
          id: f.id,
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'device token mismatch', details: { code: 'AUTH_DEVICE_TOKEN_MISMATCH' } },
        }),
    ]);
    conn.start({ url: 'ws://fake' });
    await waitFor(conn, (s) => s === 'auth-failed');
    conn.stop();
    assert.equal(getClears(), 1);
  });

  it('forgives one device-token rejection after a working session, then clears on the second', async () => {
    const reject = (ws, f) =>
      ws.emit({
        type: 'res',
        id: f.id,
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'device token mismatch', details: { code: 'AUTH_DEVICE_TOKEN_MISMATCH' } },
      });
    const { conn, getClears } = makeConnection([
      (ws, f) => {
        ws.emit(helloOk(f.id));
        setTimeout(() => ws.close(1006, ''), 20);
      },
      reject,
      reject,
    ]);
    conn.start({ url: 'ws://fake' });
    await waitFor(conn, (s) => s === 'ready');
    await waitFor(conn, (s) => s === 'auth-failed', 15000);
    conn.stop();
    assert.equal(getClears(), 1);
  });

  it('keeps the device token when the gateway only rate limits us', async () => {
    const { conn, getClears } = makeConnection([
      (ws, f) =>
        ws.emit({
          type: 'res',
          id: f.id,
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'too many failed authentication attempts', details: { code: 'AUTH_RATE_LIMITED' } },
        }),
    ]);
    conn.start({ url: 'ws://fake' });
    await waitFor(conn, (s) => s === 'auth-failed');
    conn.stop();
    assert.equal(getClears(), 0);
  });
});

describe('GatewayConnection re-pair signal', () => {
  it('reports the failure code and that a stored token was used on auth-failed', async () => {
    const { conn } = makeConnection([
      (ws, f) =>
        ws.emit({
          type: 'res',
          id: f.id,
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'device token mismatch', details: { code: 'AUTH_DEVICE_TOKEN_MISMATCH' } },
        }),
    ]);
    conn.start({ url: 'ws://fake' });
    await waitFor(conn, (s) => s === 'auth-failed');
    const info = conn.getInfo();
    conn.stop();
    assert.equal(info.failureCode, 'AUTH_DEVICE_TOKEN_MISMATCH');
    assert.equal(info.failureUsedStoredToken, true);
  });

  it('does not flag a pasted gateway token as a stored-token failure', async () => {
    const { conn } = makeConnection([
      (ws, f) =>
        ws.emit({
          type: 'res',
          id: f.id,
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'token mismatch', details: { code: 'AUTH_TOKEN_MISMATCH' } },
        }),
    ]);
    conn.start({ url: 'ws://fake', gatewayToken: 'pasted' });
    await waitFor(conn, (s) => s === 'auth-failed');
    const info = conn.getInfo();
    conn.stop();
    assert.equal(info.failureUsedStoredToken, false);
  });
});
