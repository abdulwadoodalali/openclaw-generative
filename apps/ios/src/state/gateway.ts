// The app-wide gateway connection: GatewayConnection wired to Expo/React Native platform pieces.
import { randomUUID } from 'expo-crypto';
import { clearDeviceToken, loadDeviceToken, saveDeviceToken, saveGatewayToken } from '../config';
import { GatewayConnection, type WebSocketLike } from '../openclaw/gatewayConnection';
import { loadOrCreateDeviceIdentity, signDevicePayload } from '../openclaw/deviceIdentity';

export function createAppGateway(): GatewayConnection {
  return new GatewayConnection({
    // React Native's global WebSocket (text frames only, which is all the protocol uses).
    createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
    loadIdentity: async () => {
      const identity = await loadOrCreateDeviceIdentity();
      return {
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        sign: async (payload: string) => signDevicePayload(identity, payload),
      };
    },
    tokenStore: {
      load: async () => loadDeviceToken(),
      store: async ({ token, scopes }) => saveDeviceToken({ token, scopes }),
      clear: async () => clearDeviceToken(),
    },
    createId: () => randomUUID(),
    // Once the gateway issued a device token the shared gateway token is no longer needed.
    onPaired: () => {
      void saveGatewayToken(undefined);
    },
    displayName: 'Ano RN',
    clientVersion: '0.1.0',
  });
}
