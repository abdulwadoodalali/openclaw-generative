import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  seed: string;
};

const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_INDEX: Record<string, number> = {};
for (let i = 0; i < B64URL_CHARS.length; i++) {
  B64URL_INDEX[B64URL_CHARS[i]] = i;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b1 = bytes[i++];
    const b2 = i < len ? bytes[i++] : -1;
    const b3 = i < len ? bytes[i++] : -1;

    const bitmap = (b1 << 16) | ((b2 === -1 ? 0 : b2) << 8) | (b3 === -1 ? 0 : b3);

    result += B64URL_CHARS[(bitmap >> 18) & 0x3f];
    result += B64URL_CHARS[(bitmap >> 12) & 0x3f];
    if (b2 !== -1) result += B64URL_CHARS[(bitmap >> 6) & 0x3f];
    if (b3 !== -1) result += B64URL_CHARS[bitmap & 0x3f];
  }
  return result;
}

function decodeBase64Url(input: string): Uint8Array {
  const str = input.replace(/=/g, '');
  const len = str.length;
  const bytes: number[] = [];
  let i = 0;
  while (i < len) {
    const c1 = B64URL_INDEX[str[i++]] ?? -1;
    const c2 = B64URL_INDEX[str[i++]] ?? -1;
    const c3 = i < len ? B64URL_INDEX[str[i++]] ?? -1 : -1;
    const c4 = i < len ? B64URL_INDEX[str[i++]] ?? -1 : -1;

    if (c1 === -1 || c2 === -1) {
      throw new Error('Invalid base64url string');
    }

    const bitmap = (c1 << 18) | (c2 << 12) | (c3 === -1 ? 0 : c3 << 6) | (c4 === -1 ? 0 : c4);

    bytes.push((bitmap >> 16) & 0xff);
    if (c3 !== -1) bytes.push((bitmap >> 8) & 0xff);
    if (c4 !== -1) bytes.push(bitmap & 0xff);
  }
  return Uint8Array.from(bytes);
}

function encodeHex(bytes: Uint8Array): string {
  const alphabet = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    result += alphabet[b >> 4];
    result += alphabet[b & 0xf];
  }
  return result;
}

export function createDeviceIdentity(randomBytes: (length: number) => Uint8Array): DeviceIdentity {
  const seed = randomBytes(32);
  const publicKey = ed25519.getPublicKey(seed);
  const deviceId = encodeHex(sha256(publicKey));
  return {
    deviceId,
    publicKey: encodeBase64Url(publicKey),
    seed: encodeBase64Url(seed),
  };
}

export function signDevicePayload(identity: DeviceIdentity, payload: string): string {
  const seed = decodeBase64Url(identity.seed);
  const message = new TextEncoder().encode(payload);
  const signature = ed25519.sign(message, seed);
  return encodeBase64Url(signature);
}

export function buildDeviceAuthPayloadV3(p: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
  platform: string;
  deviceFamily: string;
}): string {
  return `v3|${p.deviceId}|${p.clientId}|${p.clientMode}|${p.role}|${p.scopes.join(',')}|${p.signedAtMs}|${p.token}|${p.nonce}|${p.platform.toLowerCase()}|${p.deviceFamily.toLowerCase()}`;
}

export function validateDeviceIdentity(identity: DeviceIdentity): boolean {
  try {
    const publicKey = decodeBase64Url(identity.publicKey);
    const seed = decodeBase64Url(identity.seed);
    if (publicKey.length !== 32 || seed.length !== 32) {
      return false;
    }
    const derivedPublicKey = ed25519.getPublicKey(seed);
    if (derivedPublicKey.length !== 32) {
      return false;
    }
    for (let i = 0; i < 32; i++) {
      if (publicKey[i] !== derivedPublicKey[i]) {
        return false;
      }
    }
    const expectedDeviceId = encodeHex(sha256(publicKey));
    return identity.deviceId === expectedDeviceId;
  } catch {
    return false;
  }
}
