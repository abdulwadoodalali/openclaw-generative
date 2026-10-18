// @ts-nocheck (runs under Node with type stripping; node types are not installed)
//
// Live round trip against a real OpenClaw gateway using the app's own code: GatewayConnection
// (official gateway-client/browser), OpenClawAgent (AG-UI) and the sessions API. It proves the
// handshake, device signing, session create, streaming chat, history reload and cleanup.
//
//   OPENCLAW_TOKEN=... node scripts/live-smoke.ts [ws://127.0.0.1:18789]
//
// Needs the gateway token in the environment (read it at runtime, never write it down). Uses a
// throwaway in-memory device identity and a throwaway session, archived at the end. Never touches
// agent:<id>:main. Afterwards remove the pairing record: `openclaw devices list` then
// `openclaw devices remove <id>` (the script prints the device id).
import { randomBytes, randomUUID } from 'node:crypto';
import { GatewayConnection } from '../src/openclaw/gatewayConnection.ts';
import { OpenClawAgent } from '../src/openclaw/OpenClawAgent.ts';
import { createDeviceIdentity, signDevicePayload } from '../src/openclaw/deviceCrypto.ts';
import { archiveThread, createThread, listThreads, renameThread } from '../src/openclaw/sessionsApi.ts';

const url = process.argv[2] || 'ws://127.0.0.1:18789';
const token = process.env.OPENCLAW_TOKEN;
if (!token) {
  console.error('Set OPENCLAW_TOKEN (the gateway token) in the environment.');
  process.exit(2);
}

const identity = createDeviceIdentity((n) => randomBytes(n));
let storedToken = null;
const gw = new GatewayConnection({
  createWebSocket: (u) => new WebSocket(u),
  loadIdentity: async () => ({
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    sign: async (p) => signDevicePayload(identity, p),
  }),
  tokenStore: {
    load: async () => storedToken,
    store: async ({ token: t, scopes }) => {
      storedToken = { token: t, scopes };
    },
    clear: async () => {
      storedToken = null;
    },
  },
  createId: () => randomUUID(),
  displayName: 'Ano RN live smoke',
  log: (l) => console.log('  [gw]', l),
});

const step = (s) => console.log(`\n== ${s}`);
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  gw.stop();
  process.exit(1);
};

gw.start({ url, gatewayToken: token });
step(`connect ${url}`);
try {
  await gw.waitUntilReady(20000);
} catch (e) {
  fail(`not ready: ${e.message} (status ${gw.getInfo().status}, ${gw.getInfo().detail ?? ''})`);
}
console.log('ready, server', gw.getInfo().serverVersion, 'device', identity.deviceId.slice(0, 12), '...');
console.log('device token issued:', storedToken ? 'yes' : 'NO');

const req = (m, p) => gw.request(m, p);
const agentId = process.env.EXPO_PUBLIC_ANO_DEFAULT_AGENT || 'main';

step('create throwaway thread');
const title = `ano-ios-smoke-${Date.now()}`;
const thread = await createThread(req, { agentId, title });
console.log('thread', thread.key, 'title', thread.title);
if (thread.key.endsWith(':main')) fail('refusing to use a :main session');

step('stream a reply through OpenClawAgent');
const agent = new OpenClawAgent(gw);
await agent.openThread(thread.key);
agent.addMessage({ id: randomUUID(), role: 'user', content: 'Reply with one short friendly sentence about autumn. No lists.' });
let deltas = 0;
let errorText = null;
const t0 = Date.now();
await agent.runAgent(undefined, {
  onTextMessageContentEvent: () => {
    deltas++;
  },
  onRunErrorEvent: ({ event }) => {
    errorText = event.message;
  },
});
if (errorText) fail(`run error: ${errorText}`);
const reply = agent.messages[agent.messages.length - 1];
console.log(`reply in ${Date.now() - t0} ms, ${deltas} content events:`, JSON.stringify(reply.content));
if (reply.role !== 'assistant' || !reply.content) fail('no assistant reply');

step('reload from chat.history (fresh agent)');
const agent2 = new OpenClawAgent(gw);
await agent2.openThread(thread.key);
console.log('messages after reload:', agent2.messages.map((m) => m.role).join(', '));
if (agent2.messages.length < 2) fail('history did not contain both messages');

step('rename + list + archive');
await renameThread(req, thread.key, `${title}-renamed`);
const listed = await listThreads(req, { agentId });
const row = listed.find((t) => t.key === thread.key);
console.log('listed title:', row?.title);
if (!row) fail('thread missing from sessions.list');
await archiveThread(req, row);
const after = await listThreads(req, { agentId });
console.log('still listed after archive:', after.some((t) => t.key === thread.key));

gw.stop();
console.log('\nOK. Remove the pairing record: openclaw devices list ; openclaw devices remove <id>');
console.log('device id (public, not a secret):', identity.deviceId);
process.exit(0);
