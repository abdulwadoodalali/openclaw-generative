// Build-time configuration from EXPO_PUBLIC_* env vars (see .env.example). Expo inlines each
// `process.env.EXPO_PUBLIC_*` member access into the bundle, so every read below must stay a literal
// property access. No react-native or expo imports: pure modules import this under node --test.

function clean(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Gateway URL for devices, e.g. wss://my-mac.example-tailnet.ts.net. Null: loopback or the URL pairing hands back. */
export const ENV_OPENCLAW_URL = clean(process.env.EXPO_PUBLIC_OPENCLAW_URL);

/** MagicDNS host of the Mac running ano-pair, e.g. my-mac.example-tailnet.ts.net. Null: skip that discovery candidate. */
export const ENV_PAIR_HOST = clean(process.env.EXPO_PUBLIC_ANO_PAIR_HOST);

/** The user's first name for the greeting and agent prompts. Null: no name. */
export const ENV_USER_NAME = clean(process.env.EXPO_PUBLIC_ANO_USER_NAME);

/** OpenClaw's own default agent id. */
export const OPENCLAW_DEFAULT_AGENT = 'main';

/** The agent a new chat or canvas runs on. */
export const DEFAULT_AGENT_ID = clean(process.env.EXPO_PUBLIC_ANO_DEFAULT_AGENT) ?? OPENCLAW_DEFAULT_AGENT;

/** How agent prompts refer to the user: their name, or "the user". */
export function userRef(name: string | null = ENV_USER_NAME): string {
  return name ?? 'the user';
}
