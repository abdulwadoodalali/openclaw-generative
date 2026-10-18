import { getRandomBytes } from 'expo-crypto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type { DeviceIdentity } from './deviceCrypto';
export {
  buildDeviceAuthPayloadV3,
  signDevicePayload,
  validateDeviceIdentity,
} from './deviceCrypto';

import {
  createDeviceIdentity as createDeviceIdentityWithRandom,
  validateDeviceIdentity,
  type DeviceIdentity,
} from './deviceCrypto';

const STORAGE_KEY = 'ano.openclaw.deviceIdentity';

type StorageBackend = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

const secureStoreBackend: StorageBackend = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  deleteItem: SecureStore.deleteItemAsync,
};

function getWebStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      return window.localStorage;
    }
  } catch {
    // No window or localStorage available.
  }
  return null;
}

const localStorageBackend: StorageBackend = {
  async getItem(key) {
    return getWebStorage()?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    getWebStorage()?.setItem(key, value);
  },
  async deleteItem(key) {
    getWebStorage()?.removeItem(key);
  },
};

const memoryStorageBackend: StorageBackend = (() => {
  let value: string | null = null;
  return {
    async getItem() {
      return value;
    },
    async setItem(_key, v) {
      value = v;
    },
    async deleteItem() {
      value = null;
    },
  };
})();

async function resolveStorageBackend(): Promise<StorageBackend> {
  try {
    if (await SecureStore.isAvailableAsync()) {
      return secureStoreBackend;
    }
  } catch {
    // SecureStore unavailable; fall through.
  }
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return localStorageBackend;
  }
  return memoryStorageBackend;
}

export function createDeviceIdentity(): DeviceIdentity {
  return createDeviceIdentityWithRandom((length) => getRandomBytes(length));
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const storage = await resolveStorageBackend();
  let raw: string | null = null;
  try {
    raw = await storage.getItem(STORAGE_KEY);
  } catch {
    // Fall through to create a new identity.
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DeviceIdentity;
      if (validateDeviceIdentity(parsed)) {
        return parsed;
      }
    } catch {
      // Stored value invalid; create a new one.
    }
  }
  const identity = createDeviceIdentity();
  await storage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export async function resetDeviceIdentity(): Promise<void> {
  const storage = await resolveStorageBackend();
  await storage.deleteItem(STORAGE_KEY);
}
