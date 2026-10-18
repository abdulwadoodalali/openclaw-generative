// @ts-nocheck
// Tests run under Node with --experimental-strip-types; no @types/node in this Expo project.
// Fake fetch + fake socket: discovery order, pair + redeem, re-pair trigger, Retry-After.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createDeviceIdentity, signDevicePayload } from './deviceCrypto.ts';
import { candidateBases, discover, hostFromHostUri, PAIR_PORT } from './discovery.ts';
import { PairError, parseRetryAfterMs, requestBootstrap, resetPairState } from './pairClient.ts';
import { redeemBootstrap, pickOperatorCredential } from './pairRedeem.ts';
import { autoPair } from './autoPair.ts';
import { isRepairCode } from '../connectPolicy.ts';
import { GatewayConnection } from './gatewayConnection.ts';

const PAIR_HOST = 'my-mac.example-tailnet.ts.net';
const MAGICDNS_BASE = `http://${PAIR_HOST}:${PAIR_PORT}`;
const BOOT = 'BOOTSTRAP-SECRET-xyz';
const OP_TOKEN = 'OPERATOR-SECRET-abc';
const NODE_TOKEN = 'NODE-SECRET-def';
const GATEWAY = 'wss://gw.example.ts.net';

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const identity = createDeviceIdentity((n) => Uint8Array.from(Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff)));
const idObj = {
  deviceId: identity.deviceId,
  publicKey: identity.publicKey,
  sign: async (p) => signDevicePayload(identity, p),
};

const wellKnown = (base, over = {}) => ({
  service: 'ano-pair',
  version: 1,
  serviceVersion: '0.1.0',
  gatewayUrl: GATEWAY,
  pairUrl: `${base}/pair`,
  identityProvider: 'tailnet',
  ...over,
});

const pairOk = {
  ok: true,
  version: 1,
  issueId: 'i1',
  gatewayUrl: GATEWAY,
  bootstrapToken: BOOT,
  expiresAtMs: Date.now() + 600_000,
  redeem: {
    auth: 'bootstrapToken',
    role: 'node',
    scopes: [],
    clientId: 'openclaw-ios',
    clientMode: 'node',
    platform: 'ios',
    deviceFamily: 'iphone',
    minProtocol: 4,
    maxProtocol: 4,
  },
};

function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** Fake fetch driven by a handler. Records every call. Honors abort only via the caller's timeout. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

// ---- fake gateway socket ----------------------------------------------------------------------

class FakeSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  constructor(gateway, url) {
    this.gateway = gateway;
    gateway.urls.push(url);
    queueMicrotask(() => {
      if (gateway.unreachable) {
        this.readyState = 3;
        this.onerror?.({});
        this.onclose?.({ code: 1006, reason: '' });
        return;
      }
      this.readyState = 1;
      this.onopen?.({});
      this.nonce = `nonce-${gateway.sockets.length}`;
      this.ts = 1_700_000_000_000 + gateway.sockets.length;
      this.emit({ type: 'event', event: 'connect.challenge', payload: { nonce: this.nonce, ts: this.ts } });
    });
    gateway.sockets.push(this);
  }
  emit(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  send(data) {
    const frame = JSON.parse(data);
    if (frame.method === 'connect') {
      this.gateway.connects.push({ params: frame.params, nonce: this.nonce, ts: this.ts });
      this.gateway.respond(this, frame);
    }
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

function fakeGateway(respond) {
  const gateway = { urls: [], sockets: [], connects: [], unreachable: false, respond };
  gateway.createWebSocket = (url) => new FakeSocket(gateway, url);
  return gateway;
}

const hello = (id, auth) => ({
  type: 'res',
  id,
  ok: true,
  payload: {
    type: 'hello-ok',
    protocol: 4,
    server: { version: 'test', connId: 'c1' },
    features: { methods: [], events: [] },
    snapshot: {},
    auth,
    policy: { maxPayload: 1000000, maxBufferedBytes: 1000000, tickIntervalMs: 30000 },
  },
});

const bootstrapHandoff = (ws, f) =>
  ws.emit(
    hello(f.id, {
      method: 'bootstrap-token',
      role: 'node',
      scopes: [],
      deviceToken: NODE_TOKEN,
      deviceTokens: [
        { deviceToken: OP_TOKEN, role: 'operator', scopes: ['operator.approvals', 'operator.read', 'operator.write', 'operator.talk.secrets'], issuedAtMs: 1 },
      ],
    }),
  );

const grantFor = () => ({
  gatewayUrl: GATEWAY,
  bootstrapToken: BOOT,
  expiresAtMs: Date.now() + 600_000,
  redeem: pairOk.redeem,
});

beforeEach(() => resetPairState());

// ---- discovery --------------------------------------------------------------------------------

describe('hostFromHostUri', () => {
  it('strips the port and handles IPv6 and bare hosts', () => {
    assert.equal(hostFromHostUri('100.64.0.10:8083'), '100.64.0.10');
    assert.equal(hostFromHostUri('my-mac.local:8081'), 'my-mac.local');
    assert.equal(hostFromHostUri('[fd7a:115c::1]:8083'), '[fd7a:115c::1]');
    assert.equal(hostFromHostUri('fd7a:115c::1'), '[fd7a:115c::1]');
    assert.equal(hostFromHostUri('exp://192.168.1.4:8081/--/x'), '192.168.1.4');
    assert.equal(hostFromHostUri(undefined), null);
    assert.equal(hostFromHostUri(''), null);
  });
});

describe('discovery order', () => {
  it('lists remembered, then dev host, then MagicDNS, without duplicates', () => {
    const c = candidateBases({ hostUri: '100.64.0.10:8083', rememberedBase: 'http://100.64.0.10:4391/', pairHost: PAIR_HOST });
    assert.deepEqual(c.map((x) => [x.source, x.base]), [
      ['remembered', 'http://100.64.0.10:4391'],
      ['magicdns', MAGICDNS_BASE],
    ]);
    const d = candidateBases({ hostUri: '100.64.0.10:8083', pairHost: PAIR_HOST });
    assert.deepEqual(d.map((x) => x.source), ['dev-host', 'magicdns']);
    assert.deepEqual(candidateBases({ pairHost: PAIR_HOST }).map((x) => x.source), ['magicdns']);
  });

  it('skips MagicDNS when no pairing host is configured', () => {
    assert.deepEqual(candidateBases({ hostUri: '100.64.0.10:8083', pairHost: null }).map((x) => x.source), ['dev-host']);
    assert.deepEqual(candidateBases({ pairHost: null }), []);
  });

  it('uses the dev host first and stops at the first answer', async () => {
    const f = fakeFetch(async (url) => res(200, wellKnown(url.replace('/.well-known/ano', ''))));
    const doc = await discover(f, { hostUri: '100.64.0.10:8083', pairHost: PAIR_HOST });
    assert.equal(doc.source, 'dev-host');
    assert.equal(doc.pairUrl, 'http://100.64.0.10:4391/pair');
    assert.deepEqual(f.calls.map((c) => c.url), ['http://100.64.0.10:4391/.well-known/ano']);
  });

  it('falls through a dead dev host to MagicDNS', async () => {
    const f = fakeFetch(async (url) => {
      if (url.startsWith('http://100.64.0.10')) throw new Error('refused');
      return res(200, wellKnown(MAGICDNS_BASE));
    });
    const doc = await discover(f, { hostUri: '100.64.0.10:8083', pairHost: PAIR_HOST });
    assert.equal(doc.source, 'magicdns');
    assert.equal(f.calls.length, 2);
  });

  it('tries the remembered base before the dev host', async () => {
    const f = fakeFetch(async (url) => res(200, wellKnown(url.replace('/.well-known/ano', ''))));
    const doc = await discover(f, { hostUri: '1.2.3.4:8083', rememberedBase: 'http://9.9.9.9:4391' });
    assert.equal(doc.source, 'remembered');
    assert.equal(f.calls.length, 1);
  });

  it('times out a hung candidate after the per-candidate limit and moves on', async () => {
    const f = fakeFetch((url) => {
      if (url.startsWith('http://100.64.0.10')) return new Promise(() => {}); // never answers
      return Promise.resolve(res(200, wellKnown(MAGICDNS_BASE)));
    });
    const t0 = Date.now();
    const doc = await discover(f, { hostUri: '100.64.0.10:8083', pairHost: PAIR_HOST, timeoutMs: 60 });
    assert.equal(doc.source, 'magicdns');
    assert.ok(Date.now() - t0 < 1500);
  });

  it('rejects an unknown version, a foreign service and malformed documents', async () => {
    for (const body of [
      wellKnown('http://h:4391', { version: 2 }),
      wellKnown('http://h:4391', { version: '1' }),
      wellKnown('http://h:4391', { service: 'something-else' }),
      wellKnown('http://h:4391', { gatewayUrl: 'https://not-a-socket' }),
      wellKnown('http://h:4391', { pairUrl: 'javascript:alert(1)' }),
      null,
    ]) {
      const f = fakeFetch(async () => res(200, body));
      assert.equal(await discover(f, { hostUri: 'h:8083' }), null);
    }
    const non200 = fakeFetch(async () => res(503, wellKnown('http://h:4391')));
    assert.equal(await discover(non200, { pairHost: PAIR_HOST }), null);
  });
});

// ---- POST /pair -------------------------------------------------------------------------------

describe('requestBootstrap', () => {
  const doc = { base: 'http://h:4391', source: 'dev-host', version: 1, gatewayUrl: GATEWAY, pairUrl: 'http://h:4391/pair' };
  const req = { deviceId: identity.deviceId, publicKey: identity.publicKey, displayName: 'Ano iPhone', platform: 'ios' };

  it('posts the device identity and returns the grant', async () => {
    const f = fakeFetch(async () => res(200, pairOk));
    const grant = await requestBootstrap(f, doc, req);
    assert.equal(grant.bootstrapToken, BOOT);
    assert.equal(grant.redeem.role, 'node');
    const sent = JSON.parse(f.calls[0].body);
    assert.deepEqual(sent, { deviceId: identity.deviceId, publicKey: identity.publicKey, displayName: 'Ano iPhone', platform: 'ios' });
    assert.equal(f.calls[0].method, 'POST');
    assert.equal(f.calls[0].url, 'http://h:4391/pair');
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const f = fakeFetch(async () => {
      await gate;
      return res(200, pairOk);
    });
    const a = requestBootstrap(f, doc, req);
    const b = requestBootstrap(f, doc, req);
    release();
    const [ga, gb] = await Promise.all([a, b]);
    assert.equal(f.calls.length, 1);
    assert.equal(ga.bootstrapToken, gb.bootstrapToken);
    // The lock is released afterwards.
    await requestBootstrap(f, doc, req);
    assert.equal(f.calls.length, 2);
  });

  it('honors Retry-After on 429: reports it and sends nothing until it has passed', async () => {
    let now = 1_000_000;
    const f = fakeFetch(async () => res(429, { ok: false, error: { code: 'rate_limited' } }, { 'retry-after': '7' }));
    await assert.rejects(requestBootstrap(f, doc, req, { now: () => now }), (e) => {
      assert.ok(e instanceof PairError);
      assert.equal(e.code, 'rate_limited');
      assert.equal(e.retryAfterMs, 7000);
      return true;
    });
    assert.equal(f.calls.length, 1);
    // Inside the window: rejected locally, no new request.
    now += 3000;
    await assert.rejects(requestBootstrap(f, doc, req, { now: () => now }), (e) => e.code === 'rate_limited' && e.retryAfterMs === 4000);
    assert.equal(f.calls.length, 1);
    // After the window the gate opens again.
    now += 5000;
    const ok = fakeFetch(async () => res(200, pairOk));
    await requestBootstrap(ok, doc, req, { now: () => now });
    assert.equal(ok.calls.length, 1);
  });

  it('parses Retry-After seconds, dates and garbage', () => {
    assert.equal(parseRetryAfterMs('12'), 12000);
    assert.equal(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:10 GMT', () => Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 10000);
    assert.equal(parseRetryAfterMs(null), 30000);
    assert.equal(parseRetryAfterMs('soon'), 30000);
  });

  it('retries a 502 mint failure once, then gives up', async () => {
    let n = 0;
    const f = fakeFetch(async () => (n++ === 0 ? res(502, { ok: false, error: { code: 'mint_failed' } }) : res(200, pairOk)));
    const sleeps = [];
    const grant = await requestBootstrap(f, doc, req, { sleep: async (ms) => void sleeps.push(ms) });
    assert.equal(grant.bootstrapToken, BOOT);
    assert.equal(f.calls.length, 2);
    assert.equal(sleeps.length, 1);

    const bad = fakeFetch(async () => res(502, { ok: false, error: { code: 'mint_failed' } }));
    await assert.rejects(requestBootstrap(bad, doc, req, { sleep: async () => {} }), (e) => e.code === 'mint_failed');
    assert.equal(bad.calls.length, 2);
  });

  it('maps 403 and 503, and never leaks the token into an error', async () => {
    await assert.rejects(requestBootstrap(fakeFetch(async () => res(403, { ok: false, error: { code: 'forbidden' } })), doc, req), (e) => e.code === 'forbidden');
    await assert.rejects(requestBootstrap(fakeFetch(async () => res(503, { ok: false, error: { code: 'unavailable' } })), doc, req), (e) => e.code === 'unavailable');
    const weird = fakeFetch(async () => res(200, { ok: true, bootstrapToken: '' }));
    await assert.rejects(requestBootstrap(weird, doc, req), (e) => e.code === 'bad_response' && !String(e.message).includes(BOOT));
  });
});

// ---- redeem -----------------------------------------------------------------------------------

describe('redeemBootstrap', () => {
  const deps = (gw) => ({
    createWebSocket: gw.createWebSocket,
    identity: idObj,
    createId: (() => {
      let n = 0;
      return () => `r${++n}`;
    })(),
    displayName: 'Ano iPhone',
  });

  it('sends the node-shaped connect with a valid v3 signature and returns only the operator credential', async () => {
    const gw = fakeGateway(bootstrapHandoff);
    const cred = await redeemBootstrap(deps(gw), grantFor());
    assert.deepEqual(cred, { deviceToken: OP_TOKEN, scopes: ['operator.read', 'operator.write'] });
    assert.deepEqual(gw.urls, [GATEWAY]);

    const { params, nonce, ts } = gw.connects[0];
    assert.equal(params.minProtocol, 4);
    assert.equal(params.maxProtocol, 4);
    assert.equal(params.role, 'node');
    assert.deepEqual(params.scopes, []);
    assert.deepEqual(params.caps, []);
    assert.deepEqual(params.commands, []);
    assert.deepEqual(params.auth, { bootstrapToken: BOOT });
    assert.equal(params.client.id, 'openclaw-ios');
    assert.equal(params.client.mode, 'node');
    assert.equal(params.client.platform, 'ios');
    assert.equal(params.client.deviceFamily, 'iphone');
    assert.equal(params.device.id, identity.deviceId);
    assert.equal(params.device.publicKey, identity.publicKey);
    assert.equal(params.device.signedAt, ts);
    assert.equal(params.device.nonce, nonce);

    const payload = `v3|${identity.deviceId}|openclaw-ios|node|node||${ts}|${BOOT}|${nonce}|ios|iphone`;
    const sig = Buffer.from(params.device.signature, 'base64url');
    assert.ok(ed25519.verify(sig, new TextEncoder().encode(payload), Buffer.from(identity.publicKey, 'base64url')));
    // Sent exactly once and never as an operator.
    assert.equal(gw.connects.length, 1);
  });

  it('fails with the gateway code when the handoff is refused, and when there is no operator entry', async () => {
    const refused = fakeGateway((ws, f) =>
      ws.emit({ type: 'res', id: f.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'bad', details: { code: 'AUTH_BOOTSTRAP_TOKEN_INVALID' } } }),
    );
    await assert.rejects(redeemBootstrap(deps(refused), grantFor()), (e) => e.code === 'AUTH_BOOTSTRAP_TOKEN_INVALID' && !String(e.message).includes(BOOT));

    const nodeOnly = fakeGateway((ws, f) => ws.emit(hello(f.id, { role: 'node', scopes: [], deviceToken: NODE_TOKEN })));
    await assert.rejects(redeemBootstrap(deps(nodeOnly), grantFor()), (e) => e.code === 'no_operator_token');

    const down = fakeGateway(() => {});
    down.unreachable = true;
    await assert.rejects(redeemBootstrap(deps(down), grantFor()), (e) => ['UNREACHABLE', 'CLOSED'].includes(e.code));
  });

  it('times out when the gateway never answers', async () => {
    const silent = fakeGateway(() => {});
    await assert.rejects(redeemBootstrap({ ...deps(silent), timeoutMs: 80 }, grantFor()), (e) => e.code === 'TIMEOUT');
  });

  it('picks operator scopes down to read and write', () => {
    const c = pickOperatorCredential({ auth: { deviceTokens: [{ role: 'operator', deviceToken: 't', scopes: ['operator.read', 'operator.admin'], issuedAtMs: 1 }] } });
    assert.deepEqual(c, { deviceToken: 't', scopes: ['operator.read'] });
    assert.equal(pickOperatorCredential({ auth: { deviceTokens: [{ role: 'node', deviceToken: 't', scopes: [], issuedAtMs: 1 }] } }), null);
  });
});

// ---- full flow --------------------------------------------------------------------------------

describe('autoPair', () => {
  const makeDeps = (over = {}) => {
    const saved = { token: null, url: null, base: null };
    const gw = over.gw ?? fakeGateway(bootstrapHandoff);
    const f =
      over.fetch ??
      fakeFetch(async (url, init) => {
        if (url.endsWith('/.well-known/ano')) return res(200, wellKnown(url.replace('/.well-known/ano', '')));
        if (url.endsWith('/pair') && init?.method === 'POST') return res(200, pairOk);
        return res(404, {});
      });
    return {
      saved,
      gw,
      f,
      deps: {
        fetch: f,
        createWebSocket: gw.createWebSocket,
        loadIdentity: async () => idObj,
        createId: () => 'id',
        hostUri: '100.64.0.10:8083',
        displayName: 'Ano iPhone',
        saveDeviceToken: async (r) => void (saved.token = r),
        saveGatewayUrl: async (u) => void (saved.url = u),
        savePairBase: async (b) => void (saved.base = b),
        sleep: async () => {},
        ...over.deps,
      },
    };
  };

  it('discovers, pairs, redeems and stores only the operator credential', async () => {
    const { deps, saved, f } = makeDeps();
    const r = await autoPair(deps);
    assert.deepEqual(r, { ok: true, gatewayUrl: GATEWAY, base: 'http://100.64.0.10:4391' });
    assert.deepEqual(saved.token, { token: OP_TOKEN, scopes: ['operator.read', 'operator.write'] });
    assert.equal(saved.url, GATEWAY);
    assert.equal(saved.base, 'http://100.64.0.10:4391');
    // Discovery GET, then pair POST, in that order.
    assert.deepEqual(f.calls.map((c) => c.method), ['GET', 'POST']);
    // Neither the bootstrap nor the node token was stored anywhere.
    assert.ok(!JSON.stringify(saved).includes(BOOT));
    assert.ok(!JSON.stringify(saved).includes(NODE_TOKEN));
  });

  it('reports no-service when nothing answers discovery, without pairing', async () => {
    const f = fakeFetch(async () => {
      throw new Error('down');
    });
    const { deps, saved } = makeDeps({ fetch: f });
    const r = await autoPair(deps);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-service');
    assert.equal(saved.token, null);
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  });

  it('surfaces a 429 with its Retry-After and stores nothing', async () => {
    const f = fakeFetch(async (url, init) =>
      init?.method === 'POST' ? res(429, { ok: false, error: { code: 'rate_limited' } }, { 'retry-after': '45' }) : res(200, wellKnown(url.replace('/.well-known/ano', ''))),
    );
    const { deps, saved } = makeDeps({ fetch: f });
    const r = await autoPair(deps);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'rate-limited');
    assert.equal(r.retryAfterMs, 45000);
    assert.equal(saved.token, null);
    // A second call inside the window does not hit /pair again.
    const again = await autoPair(deps);
    assert.equal(again.reason, 'rate-limited');
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  });

  it('maps forbidden, and a refused redeem, to manual-fallback failures', async () => {
    const forbidden = fakeFetch(async (url, init) =>
      init?.method === 'POST' ? res(403, { ok: false, error: { code: 'forbidden' } }) : res(200, wellKnown(url.replace('/.well-known/ano', ''))),
    );
    const a = await autoPair(makeDeps({ fetch: forbidden }).deps);
    assert.equal(a.reason, 'forbidden');

    resetPairState();
    const refused = fakeGateway((ws, f) =>
      ws.emit({ type: 'res', id: f.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'nope', details: { code: 'AUTH_BOOTSTRAP_TOKEN_INVALID' } } }),
    );
    const { deps, saved } = makeDeps({ gw: refused });
    const b = await autoPair(deps);
    assert.equal(b.reason, 'redeem-failed');
    assert.equal(saved.token, null);
    assert.ok(!JSON.stringify(b).includes(BOOT));
    // A refused redeem is not retried with the same bootstrap token.
    assert.equal(refused.connects.length, 1);
  });
});

// ---- re-pair trigger --------------------------------------------------------------------------

describe('re-pair trigger', () => {
  const stored = { token: 'old-device-token', scopes: ['operator.read', 'operator.write'] };

  async function runWithRejection(detailCode, gatewayCode = 'INVALID_REQUEST', opts = {}) {
    const gw = fakeGateway((ws, f) => ws.emit({ type: 'res', id: f.id, ok: false, error: { code: gatewayCode, message: 'rejected', details: opts.details ?? (detailCode ? { code: detailCode } : undefined) } }));
    let tok = opts.noToken ? null : stored;
    const conn = new GatewayConnection({
      createWebSocket: gw.createWebSocket,
      loadIdentity: async () => idObj,
      tokenStore: { load: async () => tok, store: async (r) => void (tok = { token: r.token, scopes: r.scopes }), clear: async () => void (tok = null) },
      createId: () => 'x',
    });
    conn.start({ url: 'ws://fake' });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 5000);
      const off = conn.subscribeStatus(() => {
        if (['auth-failed', 'needs-pairing'].includes(conn.getInfo().status)) {
          clearTimeout(t);
          off();
          resolve();
        }
      });
    });
    const info = conn.getInfo();
    conn.stop();
    return info;
  }

  it('flags every PAIRING.md section 7 code on a stored token as a re-pair', async () => {
    for (const code of ['AUTH_TOKEN_MISMATCH', 'AUTH_DEVICE_TOKEN_MISMATCH', 'AUTH_SCOPE_MISMATCH', 'DEVICE_AUTH_SIGNATURE_INVALID', 'DEVICE_AUTH_DEVICE_ID_MISMATCH']) {
      const info = await runWithRejection(code);
      assert.equal(info.failureUsedStoredToken, true, code);
      assert.equal(isRepairCode(info.failureCode), true, code);
    }
  });

  it('flags NOT_PAIRED reported as a gateway error code', async () => {
    const info = await runWithRejection(undefined, 'NOT_PAIRED');
    assert.equal(info.failureCode, 'NOT_PAIRED');
    assert.equal(isRepairCode(info.failureCode), true);
  });

  it('treats PAIRING_REQUIRED not-paired on a stored token as a re-pair instead of waiting for approval', async () => {
    for (const reason of ['not-paired', 'scope-upgrade']) {
      const info = await runWithRejection(undefined, 'INVALID_REQUEST', { details: { code: 'PAIRING_REQUIRED', reason, requestId: 'req-1' } });
      assert.equal(info.status, 'auth-failed', reason);
      assert.equal(info.failureCode, 'NOT_PAIRED');
      assert.equal(info.failureUsedStoredToken, true);
      assert.equal(isRepairCode(info.failureCode), true);
    }
  });

  it('still waits for approval on PAIRING_REQUIRED without a stored token, or for a role upgrade', async () => {
    const fresh = await runWithRejection(undefined, 'INVALID_REQUEST', { noToken: true, details: { code: 'PAIRING_REQUIRED', reason: 'not-paired', requestId: 'req-2' } });
    assert.equal(fresh.status, 'needs-pairing');
    assert.equal(fresh.pairingRequestId, 'req-2');
    const upgrade = await runWithRejection(undefined, 'INVALID_REQUEST', { details: { code: 'PAIRING_REQUIRED', reason: 'role-upgrade', requestId: 'req-3' } });
    assert.equal(upgrade.status, 'needs-pairing');
  });

  it('does not flag a rate limit as a re-pair', async () => {
    const info = await runWithRejection('AUTH_RATE_LIMITED');
    assert.equal(isRepairCode(info.failureCode), false);
  });

  it('re-pairing replaces the rejected token with the operator credential from a fresh redeem', async () => {
    resetPairState();
    let tokenOnDisk = stored; // the rejected one; the provider clears it first
    tokenOnDisk = null;
    const gw = fakeGateway(bootstrapHandoff);
    const f = fakeFetch(async (url, init) =>
      init?.method === 'POST' ? res(200, pairOk) : res(200, wellKnown(url.replace('/.well-known/ano', ''))),
    );
    const r = await autoPair({
      fetch: f,
      createWebSocket: gw.createWebSocket,
      loadIdentity: async () => idObj,
      createId: () => 'id',
      hostUri: '100.64.0.10:8083',
      displayName: 'Ano iPhone',
      saveDeviceToken: async (rec) => void (tokenOnDisk = rec),
      saveGatewayUrl: async () => {},
      savePairBase: async () => {},
    });
    assert.equal(r.ok, true);
    assert.equal(tokenOnDisk.token, OP_TOKEN);
  });
});
