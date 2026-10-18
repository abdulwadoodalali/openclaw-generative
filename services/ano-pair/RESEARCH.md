# Research: pairing a new device without the shared gateway token

Date: 2026-10-12. OpenClaw 2026.9.8 (wire protocol v4), on a macOS host. Method: `--help` output, the docs and compiled sources shipped in `/opt/homebrew/lib/node_modules/openclaw` (docs/, dist/), the npm packages `@openclaw/gateway-client` and `@openclaw/gateway-protocol` under `apps/ios/node_modules`, and read-only commands (`tailscale whois`, `tailscale status`). Nothing was minted or approved during research. No secrets are quoted here.

## 1. Answers

### 1.1 Setup codes and bootstrap tokens

- A setup code is `base64url(JSON)` of `{ url, bootstrapToken, expiresAtMs, tlsFingerprint? }` (`encodePairingSetupCode` / `decodePairingSetupCode`, dist/setup-code-*.mjs). The `bootstrapToken` is an opaque, short-lived credential. It is NOT the shared gateway token or password.
- Lifetime: 10 minutes. `assertBootstrapTokenCurrent` refuses tokens with `issuedAtMs < now - 600000`; docs (`gateway/pairing.md`) say "expires after 10 minutes". `expiresAtMs` is authoritative in the payload.
- Single use: docs say "short-lived single-use bootstrap token". In the state machine the token is verified (`bootstrap.verify`), bound to the FIRST device identity (deviceId + public key) that presents it, then consumed once its handoff completes (`bootstrap.consume`). It is not pre-bound to a device id at mint time. So a minted code is a 10 minute bearer credential until its first redeem.
- Profiles: default setup profile is the mobile handoff: a `node` token with `scopes: []` plus an `operator` token. Full profile operator scopes: `operator.admin`, `operator.approvals`, `operator.read`, `operator.talk.secrets`, `operator.write`. With `--limited`: the same without `operator.admin`. Pairing-mutation scope is never handed off. `--voice-node` gives node + `operator.read` + `operator.talk` only.

### 1.2 Can a CLI or gateway method mint one non-interactively?

Yes, both:

- CLI: `openclaw qr --json --limited --no-ascii --url wss://my-mac.example-tailnet.ts.net`. Output JSON keys: `setupCode`, `gatewayUrl`, optional `gatewayUrls`, `auth` (non-secret label), `access`, optional `accessDowngraded`, `urlSource`. It runs `resolvePairingSetupFromConfig` and calls `issueDevicePairSetupBootstrapToken` directly against the local pairing state store (same OS user, `~/.openclaw`). It does not call the gateway over RPC and it does not need the shared token in the caller's hands (the command only checks that gateway auth is configured). `--url` avoids the Tailscale CLI lookup that the default URL resolution does (note: the macOS app's `tailscale` binary is often not on PATH). Validated by `--help`; first real mint happens only in the verification step.
- Gateway RPC: `device.pair.setupCode` (needs `operator.admin`, intentionally unadvertised) returns the same data plus `setupId`. A service would need an admin-scoped credential to use it, so the CLI is the better fit.
- `openclaw devices join-code` mints a single-use node onboarding URL, but it is for node hosts, not mobile apps.

### 1.3 Can a pending pairing be approved programmatically?

Yes: `openclaw devices approve <requestId>` (RPC `device.pair.approve`), `openclaw devices list --json` to find the requestId, `--latest` is interactive-ish. Pending device requests expire 5 minutes after the device's last retry. This needs the CLI/gateway to authenticate (it uses local config), and it requires the app to first connect with some credential that gets as far as creating a pending request. It is strictly more moving parts than the bootstrap flow, so it is only the fallback.

### 1.4 What does the redeemed credential contain and which scopes?

- Redeem: connect with `auth: { bootstrapToken }` as `role: "node"`, `scopes: []`, `client.mode: "node"`, `client.id: "openclaw-ios"`, `platform: "ios"` (or `ipados`), `deviceFamily: "iphone"` (or `ipad`/`ios`), plus the signed `device` block (v3 payload where the `<token>` field is the bootstrap token). The gateway matches `isSetupCodeMobileBootstrapClient` and pairs silently, no `devices approve` needed ("Official OpenClaw iOS and Android apps connect automatically when their setup-code metadata matches"; a mismatch leaves the request pending).
- `hello-ok.auth` then carries `deviceToken` (role node, scopes `[]`) and `deviceTokens[]` with the bounded operator token: `operator.read`, `operator.write`, `operator.approvals`, `operator.talk.secrets` (no `operator.admin` with `--limited`, no pairing scopes). Each entry: `{ deviceToken, role, scopes, issuedAtMs }`. Persist the operator entry only (after a redeem over a trusted transport such as `wss://`).
- Operator-role connects with a bootstrap token are NOT silent (only the node-shaped connect is). So the redeem connection must be the node-shaped one, then the app reconnects as a normal operator (`mode: "ui"`) using the operator device token. The node role stays recorded on the device entry; it has no scopes and no declared commands, so it grants nothing. It can be removed with `openclaw devices revoke --device <id> --role node` if desired.
- Revocation: `openclaw devices revoke|rotate|remove`. Removing the device kills all its tokens. Revoking a setup code does not revoke an already paired device.

### 1.5 Decision

Use bootstrap tokens (setup codes) minted by `openclaw qr --json --limited`. Never hand out the shared token. Approve-after-pending is not needed.

## 2. How the official OpenClaw iOS app discovers gateways

- Bonjour/mDNS service type `_openclaw-gw._tcp` on `local.`. The iOS app uses `NWBrowser`. TXT keys include `lanHost`, `gatewayPort`, `gatewayTlsSha256`, optional `tailnetDns` (only in `discovery.mdns.mode="full"`; default is `minimal` which omits it). TXT is unauthenticated: clients must resolve SRV + A/AAAA and treat TXT as hints.
- Cross-network: wide-area unicast DNS-SD (zone like `openclaw.internal.`) served by a CoreDNS on the gateway host over Tailscale, with split DNS on the tailnet. Not configured here.
- Direct tailnet target: MagicDNS name (preferred) or tailnet IP. iOS requires a secure first-time tailnet/public connect (`wss://`, e.g. Tailscale Serve), not plaintext.
- Docs: `gateway/discovery.md`, `gateway/bonjour.md`, `platforms/ios.md`.

Consequence for us: Expo Go cannot run `NWBrowser` (no custom native modules), and mDNS multicast does not cross to a phone on cellular anyway. Hence the dev-server host and MagicDNS discovery below.

## 3. Expo Go: dev server host

Verified live: `curl -H "Expo-Platform: ios" -H "Accept: application/expo+json" http://100.64.0.10:8083/` returns a manifest whose `extra.expoClient.hostUri` is `100.64.0.10:8083` (and `extra.expoGo.debuggerHost` the same). That is the value `Constants.expoConfig?.hostUri` (expo-constants, type `hostUri?: string` in `Constants.types.d.ts`) exposes in a dev bundle in Expo Go. Format is `host:port` with no scheme. In a production or standalone build `hostUri` is undefined, so the app must treat it as optional and fall through to the next discovery step. This is how the app learns which Mac served it.

## 4. Tailscale identity facts (macOS)

- Binary: `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (not on PATH).
- `tailscale whois --json <mac tailnet ip>` and `... <phone tailnet ip>` both return the owner's `UserProfile.LoginName` (e.g. `you@example.com`) when both devices belong to the same user. `Node.Name` is the MagicDNS FQDN, `Node.Tags` is absent for user-owned devices (tagged devices have no user, so we reject them).
- `whois 127.0.0.1` and `whois <LAN IP>` fail with "peer not found". So loopback peers cannot be identified by whois; the service maps loopback to the Mac's own tailnet IP (see PAIRING.md, "Loopback"). LAN peers never resolve, and the server does not listen on the LAN IP anyway.
- The Mac's own tailnet IP resolves to its owner, so calls from this Mac to its tailnet IP are identified normally.

## 5. Gateway facts relevant to the service

- Gateway listens on `127.0.0.1:18789` and `[::1]:18789` only. Tailscale Serve exposes it as `wss://my-mac.example-tailnet.ts.net` (443). ano-pair uses port 4391. Expo dev servers typically use 8081 or 8083.
- Phone connects through Serve, so the gateway treats it as remote: that is why a plain device connect would need approval, and why a setup code is the right tool.
- Open item for the verification step: the bootstrap redeem is verified over loopback `ws://127.0.0.1:18789` (local pairing path) and over the real `wss://` Serve URL.
