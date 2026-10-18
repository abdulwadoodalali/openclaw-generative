import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleIdentityProvider, TailnetIdentityProvider, createIdentityProvider } from '../lib/identity.mjs';
import { assertSafeBindAddress, loadConfig } from '../lib/config.mjs';

const OWNER = 'you@example.com';
const MAC = '100.64.0.10';
const PHONE = '100.64.0.20';
const ENV = { ANO_PAIR_TAILNET_IP: MAC, ANO_PAIR_ALLOWED_LOGINS: OWNER, ANO_PAIR_MAGICDNS: 'my-mac.example-tailnet.ts.net' };
const who = (login, extra = {}) => ({ Node: { Name: 'n.ts.net.', ...extra }, UserProfile: { ID: 1, LoginName: login, DisplayName: 'D' } });
const make = (map, opts = {}) => {
  const calls = [];
  const p = new TailnetIdentityProvider({
    allowedLogins: [OWNER], selfIp: MAC, loopback: 'self', ...opts,
    whois: async (ip) => { calls.push(ip); if (!(ip in map)) throw new Error('peer not found'); return map[ip]; },
  });
  return { p, calls };
};

test('tailnet: allows the owner from their phone IP', async () => {
  const { p } = make({ [PHONE]: who(OWNER) });
  const r = await p.authenticate({ remoteAddress: PHONE });
  assert.equal(r.ok, true);
  assert.equal(r.identity.login, OWNER);
});

test('tailnet: rejects another user on the tailnet', async () => {
  const { p } = make({ '100.64.0.9': who('someone@else.com') });
  const r = await p.authenticate({ remoteAddress: '100.64.0.9' });
  assert.deepEqual([r.ok, r.code], [false, 'forbidden']);
});

test('tailnet: rejects tagged nodes and nodes without a user', async () => {
  const { p } = make({ '100.64.0.1': who(OWNER, { Tags: ['tag:server'] }), '100.64.0.2': { Node: {}, UserProfile: {} } });
  assert.equal((await p.authenticate({ remoteAddress: '100.64.0.1' })).ok, false);
  assert.equal((await p.authenticate({ remoteAddress: '100.64.0.2' })).ok, false);
});

test('tailnet: login match is exact, not a prefix', async () => {
  const { p } = make({ '100.64.0.3': who('you@evil.com'), '100.64.0.4': who('you@example.com.evil.com') });
  assert.equal((await p.authenticate({ remoteAddress: '100.64.0.3' })).ok, false);
  assert.equal((await p.authenticate({ remoteAddress: '100.64.0.4' })).ok, false);
});

test('tailnet: non-tailnet peers (LAN, public) are refused without calling whois', async () => {
  const { p, calls } = make({});
  for (const ip of ['10.0.0.5', '192.168.1.5', '8.8.8.8', '100.63.255.255', '100.128.0.1']) {
    assert.equal((await p.authenticate({ remoteAddress: ip })).ok, false, ip);
  }
  assert.equal(calls.length, 0);
});

test('tailnet: IPv4-mapped IPv6 peer address is normalised', async () => {
  const { p } = make({ [PHONE]: who(OWNER) });
  assert.equal((await p.authenticate({ remoteAddress: `::ffff:${PHONE}` })).ok, true);
});

test('tailnet: loopback is identified as this Mac own tailnet node', async () => {
  const { p, calls } = make({ [MAC]: who(OWNER) });
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal((await p.authenticate({ remoteAddress: a })).ok, true, a);
  assert.deepEqual([...new Set(calls)], [MAC]);
});

test('tailnet: loopback with proxy headers is refused', async () => {
  const { p } = make({ [MAC]: who(OWNER) });
  const r = await p.authenticate({ remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4' } });
  assert.equal(r.ok, false);
});

test('tailnet: loopback=deny refuses loopback', async () => {
  const { p } = make({ [MAC]: who(OWNER) }, { loopback: 'deny' });
  assert.equal((await p.authenticate({ remoteAddress: '127.0.0.1' })).ok, false);
});

test('tailnet: whois results are cached', async () => {
  const { p, calls } = make({ [PHONE]: who(OWNER) });
  await p.authenticate({ remoteAddress: PHONE });
  await p.authenticate({ remoteAddress: PHONE });
  assert.equal(calls.length, 1);
});

test('google stub fails closed', async () => {
  const r = await new GoogleIdentityProvider().authenticate({});
  assert.deepEqual([r.ok, r.code], [false, 'unavailable']);
  assert.equal(createIdentityProvider({ provider: 'google' }).name, 'google');
  assert.throws(() => createIdentityProvider({ provider: 'nope' }));
});

test('bind safety: only loopback and Tailscale addresses', () => {
  for (const ok of ['127.0.0.1', '::1', MAC, '100.64.0.1']) assert.equal(assertSafeBindAddress(ok), ok);
  for (const bad of ['0.0.0.0', '::', '10.0.0.5', '192.168.1.2', '8.8.8.8']) assert.throws(() => assertSafeBindAddress(bad), bad);
  assert.throws(() => loadConfig({ ...ENV, ANO_PAIR_BIND: '0.0.0.0' }));
  assert.deepEqual(loadConfig(ENV).bindAddresses, ['127.0.0.1', MAC]);
});

test('config: required values fail fast, no personal defaults', () => {
  assert.throws(() => loadConfig({}), /ANO_PAIR_TAILNET_IP is required/);
  assert.throws(() => loadConfig({ ...ENV, ANO_PAIR_ALLOWED_LOGINS: '' }), /ANO_PAIR_ALLOWED_LOGINS is required/);
  assert.throws(() => loadConfig({ ...ENV, ANO_PAIR_ALLOWED_LOGINS: ' , ' }), /ANO_PAIR_ALLOWED_LOGINS is required/);
  assert.throws(() => loadConfig({ ...ENV, ANO_PAIR_TAILNET_IP: '10.0.0.5' }), /not a Tailscale/);
  assert.throws(() => loadConfig({ ...ENV, ANO_PAIR_MAGICDNS: '' }), /ANO_PAIR_GATEWAY_URL is required/);
  const c = loadConfig({ ...ENV, ANO_PAIR_ALLOWED_LOGINS: 'You@Example.com, b@example.com' });
  assert.deepEqual(c.allowedLogins, ['you@example.com', 'b@example.com']);
  assert.equal(c.gatewayUrl, 'wss://my-mac.example-tailnet.ts.net');
  assert.equal(loadConfig({ ...ENV, ANO_PAIR_MAGICDNS: '', ANO_PAIR_GATEWAY_URL: 'wss://gw.example' }).gatewayUrl, 'wss://gw.example');
});
