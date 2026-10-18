// App settings and credentials, persisted through src/storage.ts.
//
// Secrets: the shared gateway token is only needed for the very first connect. After pairing the
// gateway hands back a per-device token, which is all we keep. Nothing here is hardcoded.
import { SIMULATOR_URL, defaultGatewayUrl } from './connectPolicy';
import { DEFAULT_AGENT_ID, ENV_OPENCLAW_URL } from './env';
import { kvDelete, kvGet, kvSet } from './storage';

export type Settings = {
  url: string;
  /** The OpenClaw agent new chats and canvases run on (any id the gateway's agents.list returns). */
  agentId: string;
};

export type Secrets = {
  /** Shared gateway token. Only used until the device is paired, then dropped. */
  gatewayToken?: string;
};

export { SIMULATOR_URL };

// The gateway URL comes from EXPO_PUBLIC_OPENCLAW_URL. Never a token: tokens are never baked into the
// bundle (the dev server hands the bundle out unauthenticated), they are pasted once on the device and
// kept in the Keychain.
export const DEFAULT_SETTINGS: Settings = {
  url: defaultGatewayUrl(ENV_OPENCLAW_URL),
  agentId: DEFAULT_AGENT_ID,
};

const SETTINGS_KEY = 'ano.settings';
const GATEWAY_TOKEN_KEY = 'ano.gatewayToken';
const DEVICE_TOKEN_KEY = 'ano.deviceToken';

export async function loadSettings(): Promise<Settings> {
  const raw = await kvGet(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      url: typeof parsed.url === 'string' && parsed.url ? parsed.url : DEFAULT_SETTINGS.url,
      agentId: typeof parsed.agentId === 'string' && parsed.agentId ? parsed.agentId : DEFAULT_SETTINGS.agentId,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await kvSet(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadSecrets(): Promise<Secrets> {
  const gatewayToken = await kvGet(GATEWAY_TOKEN_KEY);
  return { gatewayToken: gatewayToken || undefined };
}

export async function saveGatewayToken(token: string | undefined): Promise<void> {
  if (token) await kvSet(GATEWAY_TOKEN_KEY, token);
  else await kvDelete(GATEWAY_TOKEN_KEY);
}

export type DeviceTokenRecord = { token: string; scopes: string[] };

export async function loadDeviceToken(): Promise<DeviceTokenRecord | null> {
  const raw = await kvGet(DEVICE_TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceTokenRecord>;
    if (typeof parsed.token === 'string' && parsed.token) {
      return { token: parsed.token, scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : [] };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function saveDeviceToken(record: DeviceTokenRecord): Promise<void> {
  await kvSet(DEVICE_TOKEN_KEY, JSON.stringify(record));
}

export async function clearDeviceToken(): Promise<void> {
  await kvDelete(DEVICE_TOKEN_KEY);
}


// ---- automatic pairing (ano-pair) -------------------------------------------------------------
// The gateway URL the service returned lives in Settings.url (so a stored deviceToken + gatewayUrl
// is all a later launch needs). The base that answered discovery is remembered so the next
// pairing attempt tries it first.
const PAIR_BASE_KEY = 'ano.pairBase';

export async function loadPairBase(): Promise<string | null> {
  return (await kvGet(PAIR_BASE_KEY)) || null;
}

export async function savePairBase(base: string): Promise<void> {
  await kvSet(PAIR_BASE_KEY, base);
}

export async function saveGatewayUrl(url: string): Promise<void> {
  const current = await loadSettings();
  await saveSettings({ ...current, url });
}
