// Pure connection policy: which gateway URL to default to and whether to connect on launch.
// No react-native or expo imports, so it runs under node --test.

/** Gateway on the Mac itself (iOS simulator, web preview). The gateway only listens on loopback. */
export const SIMULATOR_URL = 'ws://127.0.0.1:18789';

/**
 * The configured URL (EXPO_PUBLIC_OPENCLAW_URL, e.g. your Tailscale Serve front) wins. Without it
 * loopback: right for web and the simulator, and a device pairs itself through ano-pair, which hands
 * back the real gateway URL.
 */
export function defaultGatewayUrl(envUrl?: string | null): string {
  return envUrl?.trim() || SIMULATOR_URL;
}

export type StartupDecision =
  /** A credential is stored: connect right away, never open Settings. */
  | 'auto-connect'
  /** Nothing stored: discover the pairing service and pair by itself (brief "Connecting to Ano"). */
  | 'auto-pair'
  /** Automatic pairing failed: open the Settings sheet for manual URL and token entry. */
  | 'needs-setup';

/**
 * After the first successful pairing the per-device token alone is enough forever. Before that the
 * shared gateway token (pasted by hand, the legacy fallback) is a credential. With neither the app
 * pairs itself through the ano-pair service; Settings only opens if that fails.
 */
export function decideStartup(creds: { hasDeviceToken: boolean; hasGatewayToken: boolean }): StartupDecision {
  return creds.hasDeviceToken || creds.hasGatewayToken ? 'auto-connect' : 'auto-pair';
}

/**
 * Gateway connect failures that mean "the stored device token is no good": the token was revoked or
 * the device removed on the Mac, the signature no longer verifies, or the scopes drifted. The app
 * re-pairs once through ano-pair instead of asking for a token. See PAIRING.md section 7.
 */
export function isRepairCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return (
    code === 'AUTH_TOKEN_MISMATCH' ||
    code === 'AUTH_DEVICE_TOKEN_MISMATCH' ||
    code === 'AUTH_SCOPE_MISMATCH' ||
    code === 'NOT_PAIRED' ||
    code.startsWith('DEVICE_AUTH_')
  );
}

/**
 * PAIRING_REQUIRED reasons that, while holding a stored device token, mean the Mac forgot this device
 * (removed or revoked: "not-paired") or the grant shrank ("scope-upgrade"). Re-pair instead of waiting
 * for a manual `openclaw devices approve`. This is the NOT_PAIRED case of PAIRING.md section 7 as the
 * gateway really reports it. role-upgrade and metadata-upgrade still wait for approval.
 */
export function isRepairPairingReason(reason: string | undefined | null): boolean {
  return reason === 'not-paired' || reason === 'scope-upgrade';
}

/**
 * Re-pairing after "the Mac forgot this device" needs a NEW device identity. Finding that out costs a
 * connect with the stale token, and the gateway answers it by opening a pending (non-silent) request
 * for the old device id. While that request exists a bootstrap redeem for the same id is refused with
 * PAIRING_REQUIRED (verified live 2026-10-12), so the old id is abandoned. The orphaned pending request
 * is harmless and expires; `openclaw devices reject <id>` clears it sooner.
 */
export function repairNeedsFreshIdentity(code: string | undefined | null): boolean {
  return code === 'NOT_PAIRED';
}

/** The commands to run on the Mac while a pairing request is pending. */
export function pairingCommands(requestId?: string): string[] {
  return ['openclaw devices list', `openclaw devices approve ${requestId || '<id>'}`];
}
