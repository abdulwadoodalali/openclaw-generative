// Automatic discovery + pairing: find ano-pair, POST /pair, redeem the bootstrap token, keep the
// operator credential. One attempt, no loops (PAIRING.md sections 2 to 4). No react-native or expo
// imports: the host injects fetch, WebSocket, the identity and the storage writers.
import type { GatewayBrowserDeviceIdentity } from '@openclaw/gateway-client/browser';
import { discover, type FetchLike } from './discovery.ts';
import { PairError, requestBootstrap } from './pairClient.ts';
import { RedeemError, redeemBootstrap } from './pairRedeem.ts';
import type { WebSocketLike } from './gatewayConnection.ts';

export type AutoPairFailureReason =
  | 'no-service'
  | 'forbidden'
  | 'rate-limited'
  | 'unavailable'
  | 'redeem-failed'
  | 'error';

export type AutoPairResult =
  | { ok: true; gatewayUrl: string; base: string }
  | { ok: false; reason: AutoPairFailureReason; message: string; retryAfterMs?: number };

export type AutoPairDeps = {
  fetch: FetchLike;
  createWebSocket: (url: string) => WebSocketLike;
  loadIdentity: () => Promise<GatewayBrowserDeviceIdentity & { publicKey: string }>;
  createId: () => string;
  /** Expo's Constants.expoConfig?.hostUri (undefined in production builds). */
  hostUri?: string | null;
  rememberedBase?: string | null;
  displayName: string;
  clientVersion?: string;
  saveDeviceToken: (record: { token: string; scopes: string[] }) => Promise<void>;
  saveGatewayUrl: (url: string) => Promise<void>;
  savePairBase: (base: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  probeTimeoutMs?: number;
  redeemTimeoutMs?: number;
};

const NO_SERVICE_MESSAGE =
  'Could not find the Ano pairing service. Is Tailscale on and the Mac awake? You can still connect by hand below.';

export async function autoPair(deps: AutoPairDeps): Promise<AutoPairResult> {
  const doc = await discover(deps.fetch, {
    hostUri: deps.hostUri,
    rememberedBase: deps.rememberedBase,
    timeoutMs: deps.probeTimeoutMs,
  });
  if (!doc) return { ok: false, reason: 'no-service', message: NO_SERVICE_MESSAGE };

  try {
    const identity = await deps.loadIdentity();
    const grant = await requestBootstrap(
      deps.fetch,
      doc,
      { deviceId: identity.deviceId, publicKey: identity.publicKey, displayName: deps.displayName, platform: 'ios' },
      { sleep: deps.sleep, now: deps.now },
    );
    const credential = await redeemBootstrap(
      {
        createWebSocket: deps.createWebSocket,
        identity,
        createId: deps.createId,
        displayName: deps.displayName,
        clientVersion: deps.clientVersion,
        timeoutMs: deps.redeemTimeoutMs,
      },
      grant,
    );
    // Only the operator credential is kept. The bootstrap and node tokens never leave this scope.
    await deps.saveDeviceToken({ token: credential.deviceToken, scopes: credential.scopes });
    await deps.saveGatewayUrl(grant.gatewayUrl);
    await deps.savePairBase(doc.base).catch(() => undefined);
    return { ok: true, gatewayUrl: grant.gatewayUrl, base: doc.base };
  } catch (e) {
    if (e instanceof PairError) {
      switch (e.code) {
        case 'rate_limited':
          return { ok: false, reason: 'rate-limited', message: e.message, retryAfterMs: e.retryAfterMs };
        case 'forbidden':
        case 'unauthenticated':
          return { ok: false, reason: 'forbidden', message: 'This device is not allowed to pair with Ano. Use the manual token below.' };
        case 'unavailable':
        case 'mint_failed':
          return { ok: false, reason: 'unavailable', message: e.message };
        case 'network':
          return { ok: false, reason: 'no-service', message: NO_SERVICE_MESSAGE };
        default:
          return { ok: false, reason: 'error', message: e.message };
      }
    }
    if (e instanceof RedeemError) {
      return { ok: false, reason: 'redeem-failed', message: `${e.message} You can connect by hand below.` };
    }
    return { ok: false, reason: 'error', message: 'Pairing failed. You can connect by hand below.' };
  }
}
