// @ts-nocheck
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import {
  buildDeviceAuthPayloadV3,
  createDeviceIdentity,
  signDevicePayload,
} from '../src/openclaw/deviceCrypto.ts';

function base64UrlToBuffer(input: string): Buffer {
  const base64 = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(base64, 'base64');
}

const identity = createDeviceIdentity((length) => randomBytes(length));

const payload = buildDeviceAuthPayloadV3({
  deviceId: identity.deviceId,
  clientId: 'test-client',
  clientMode: 'mobile',
  role: 'device',
  scopes: ['chat:read', 'chat:write'],
  signedAtMs: 1700000000000,
  token: '',
  nonce: 'abc123',
  platform: 'iOS',
  deviceFamily: 'iPhone',
});

const signature = base64UrlToBuffer(signDevicePayload(identity, payload));
const publicKeyRaw = base64UrlToBuffer(identity.publicKey);
const spki = Buffer.concat([
  Buffer.from('302a300506032b6570032100', 'hex'),
  publicKeyRaw,
]);
const publicKeyObject = createPublicKey({ key: spki, format: 'der', type: 'spki' });

const isValid = verify(null, Buffer.from(payload, 'utf8'), publicKeyObject, signature);
if (!isValid) {
  throw new Error('Signature verification failed');
}

console.log('OK');
