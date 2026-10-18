// Persistence for generative UI state: a JSON file `ano/<fileName>` in the document directory on
// native (expo-file-system, SDK 57 File/Directory/Paths API), localStorage on web. Used for the
// component registry (`components.json`) and the per-thread catalog-seen map (`catalogSeen.json`),
// both too large for the Keychain-backed key-value store.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { RegistryStorage } from './registry.ts';

const REGISTRY_FILE = 'components.json';
const REGISTRY_WEB_KEY = 'ano.genui.registry';

function createWebStorage(webKey: string): RegistryStorage {
  return {
    async load() {
      try {
        return globalThis.localStorage?.getItem(webKey) ?? null;
      } catch {
        return null;
      }
    },
    async save(json) {
      globalThis.localStorage?.setItem(webKey, json);
    },
  };
}

function createFileStorage(fileName: string): RegistryStorage {
  const directory = new Directory(Paths.document, 'ano');
  const file = new File(directory, fileName);
  return {
    async load() {
      try {
        return file.exists ? await file.text() : null;
      } catch {
        return null;
      }
    },
    async save(json) {
      directory.create({ intermediates: true, idempotent: true });
      if (!file.exists) file.create();
      await file.write(json);
    },
  };
}

/** Storage for the current platform. `load` never throws; `save` may reject (callers swallow it). */
export function createJsonFileStorage(fileName: string, webKey: string): RegistryStorage {
  return Platform.OS === 'web' ? createWebStorage(webKey) : createFileStorage(fileName);
}

export function createRegistryStorage(): RegistryStorage {
  return createJsonFileStorage(REGISTRY_FILE, REGISTRY_WEB_KEY);
}
