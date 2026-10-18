// @ts-nocheck (runs under Node with type stripping; node types are not installed)
//
// Live end-to-end of automatic discovery + pairing using the app's OWN modules (autoPair,
// GatewayConnection) against the real ano-pair service and gateway. No shared gateway token is
// used or read. A throwaway in-memory device identity is created, paired, used as operator, then
// removed from the gateway, then re-paired through the app's re-pair path, then removed again.
//
//   node --experimental-strip-types scripts/live-pair-e2e.ts <hostUri>     (or ANO_PAIR_HOST_URI, e.g. 100.64.0.10:8083)
//
// Never prints tokens. Leaves the device list as it found it (it runs `openclaw devices remove`).
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { autoPair } from '../src/openclaw/autoPair.ts';
import { resetPairState } from '../src/openclaw/pairClient.ts';
import { createDeviceIdentity, signDevicePayload } from '../src/openclaw/deviceCrypto.ts';
import { GatewayConnection } from '../src/openclaw/gatewayConnection.ts';
import { isRepairCode } from '../src/connectPolicy.ts';

const hostUri = process.argv[2] || process.env.ANO_PAIR_HOST_URI;
if (!hostUri) {
  console.error('Pass the Mac host as <host>:<port> (for example 100.64.0.10:8083) or set ANO_PAIR_HOST_URI.');
  process.exit(2);
}
const OPENCLAW = process.env.ANO_PAIR_OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';

const newIdentity = () => {
  const identity = createDeviceIdentity((n) => randomBytes(n));
  return {
    identity,
    idObj: {
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      sign: async (p) => signDevicePayload(identity, p),
    },
  };
};
let { identity, idObj } = newIdentity();
const used = [identity.deviceId];
let store = { token: null, url: null, base: null };
const log = (...a) => console.log(...a);
const fail = (m) => {
  log(`FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
function removeDevice(id) {
  try {
    const out = execFileSync(OPENCLAW, ['devices', 'remove', id, '--json'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
    log('cleanup: devices remove', id.slice(0, 12), '->', out.replace(/\s+/g, ' ').trim().slice(0, 100));
  } catch {
    // not paired (already removed)
  }
}
function rejectPending() {
  // A removed device that reconnects with a stale token leaves a pending request: reject ours.
  try {
    const list = JSON.parse(execFileSync(OPENCLAW, ['devices', 'list', '--json'], { encoding: 'utf8', timeout: 30000 }));
    for (const p of list.pending ?? []) {
      if (used.includes(p.deviceId)) {
        execFileSync(OPENCLAW, ['devices', 'reject', p.requestId], { encoding: 'utf8', timeout: 30000 });
        log('cleanup: rejected pending request for', p.deviceId.slice(0, 12));
      }
    }
  } catch {
    log('cleanup note: could not check pending requests');
  }
}
function cleanup() {
  rejectPending();
  for (const id of used) removeDevice(id);
}

const pair = () =>
  autoPair({
    fetch: (url, init) => fetch(url, init),
    createWebSocket: (u) => new WebSocket(u),
    loadIdentity: async () => idObj,
    createId: () => randomUUID(),
    hostUri,
    rememberedBase: store.base,
    displayName: 'Ano live pair e2e (throwaway)',
    saveDeviceToken: async (r) => void (store.token = r),
    saveGatewayUrl: async (u) => void (store.url = u),
    savePairBase: async (b) => void (store.base = b),
  });

function makeConn() {
  return new GatewayConnection({
    createWebSocket: (u) => new WebSocket(u),
    loadIdentity: async () => idObj,
    tokenStore: {
      load: async () => store.token,
      store: async ({ token, scopes }) => void (store.token = { token, scopes }),
      clear: async () => void (store.token = null),
    },
    createId: () => randomUUID(),
    displayName: 'Ano live pair e2e (throwaway)',
  });
}

function waitStatus(conn, wanted, ms = 25000) {
  return new Promise((resolve, reject) => {
    const hit = () => wanted.includes(conn.getInfo().status);
    if (hit()) return resolve(conn.getInfo());
    const t = setTimeout(() => reject(new Error(`timeout, status ${conn.getInfo().status}`)), ms);
    const off = conn.subscribeStatus(() => {
      if (hit()) {
        clearTimeout(t);
        off();
        resolve(conn.getInfo());
      }
    });
  });
}

log('throwaway deviceId:', identity.deviceId);

// 1. discovery + pair + redeem (no shared token anywhere)
log('\n== 1. autoPair (discover, POST /pair, node redeem)');
const r1 = await pair();
if (!r1.ok) fail(`autoPair: ${r1.reason} ${r1.message}`);
log('autoPair ok -> gatewayUrl', r1.gatewayUrl, 'base', r1.base);
log('stored operator credential: scopes', store.token.scopes.join(','), '(token not printed)');

// 2. normal operator connect with the stored device token only
log('\n== 2. operator connect with the stored device token (no shared token)');
const conn = makeConn();
conn.start({ url: store.url });
try {
  await waitStatus(conn, ['ready']);
} catch (e) {
  fail(`operator connect: ${e.message} ${JSON.stringify({ code: conn.getInfo().failureCode, detail: conn.getInfo().detail })}`);
}
log('operator hello-ok -> status ready, server', conn.getInfo().serverVersion);
const agents = await conn.request('agents.list', {});
log('agents.list ok ->', { count: agents.agents?.length, defaultId: agents.defaultId });
conn.stop();

// 3. the device is removed on the Mac: the stored token is now stale
log('\n== 3. remove the device on the gateway, then connect with the now-stale token');
removeDevice(identity.deviceId);
const stale = makeConn();
stale.start({ url: store.url });
let info;
try {
  info = await waitStatus(stale, ['auth-failed', 'ready']);
} catch (e) {
  fail(`stale connect: ${e.message}`);
}
stale.stop();
log('stale token result ->', { status: info.status, failureCode: info.failureCode, usedStoredToken: info.failureUsedStoredToken, repairTrigger: isRepairCode(info.failureCode) });
if (info.status === 'ready') fail('stale token unexpectedly accepted');
if (!(info.failureUsedStoredToken && isRepairCode(info.failureCode))) fail('stale token did not produce a re-pair trigger');

// 4. re-pair once, then operator connect again
log('\n== 4. re-pair (clear token, discovery + /pair + redeem again)');
store.token = null;
resetPairState();
// The app abandons the old device id after NOT_PAIRED (a pending request now blocks a silent re-pair).
({ identity, idObj } = newIdentity());
used.push(identity.deviceId);
log('fresh deviceId for the re-pair:', identity.deviceId);
const r2 = await pair();
if (!r2.ok) fail(`re-pair: ${r2.reason} ${r2.message}`);
const conn2 = makeConn();
conn2.start({ url: store.url });
try {
  await waitStatus(conn2, ['ready']);
} catch (e) {
  fail(`operator connect after re-pair: ${e.message} ${JSON.stringify({ code: conn2.getInfo().failureCode })}`);
}
log('operator hello-ok after re-pair -> status ready');
conn2.stop();

log('\nE2E OK: hello-ok as operator without the shared gateway token, and the re-pair path works');
cleanup();
process.exit(0);
