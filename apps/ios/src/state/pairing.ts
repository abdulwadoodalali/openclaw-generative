// Host wiring for automatic pairing: Expo/React Native pieces injected into openclaw/autoPair.
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { loadPairBase, saveDeviceToken, saveGatewayUrl, savePairBase } from '../config';
import { autoPair, type AutoPairResult } from '../openclaw/autoPair';
import type { WebSocketLike } from '../openclaw/gatewayConnection';
import { loadOrCreateDeviceIdentity, signDevicePayload } from '../openclaw/deviceIdentity';

export function runAutoPair(): Promise<AutoPairResult> {
  return (async () => {
    const rememberedBase = await loadPairBase();
    return autoPair({
      fetch: (url, init) => fetch(url, init) as ReturnType<Parameters<typeof autoPair>[0]['fetch']>,
      createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
      loadIdentity: async () => {
        const identity = await loadOrCreateDeviceIdentity();
        return {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          sign: async (payload: string) => signDevicePayload(identity, payload),
        };
      },
      createId: () => randomUUID(),
      hostUri: Constants.expoConfig?.hostUri ?? null,
      rememberedBase,
      displayName: 'Ano iPhone',
      clientVersion: '0.1.0',
      saveDeviceToken,
      saveGatewayUrl,
      savePairBase,
    });
  })();
}
