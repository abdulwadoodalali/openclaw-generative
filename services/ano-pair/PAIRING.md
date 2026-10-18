# ano-pair: contract for the Ano app

Status: implemented and verified end to end on 2026-10-12 (see "Verification"). Research behind the choices: `RESEARCH.md`.

Goal: the app finds the gateway and gets its own credentials with no typed URL and no pasted shared token. For now the identity rule is "the caller is on the owner's tailnet (an allowlisted Tailscale login)". Later, users plus Google sign-in will issue the credential through the same endpoint by swapping the identity provider.

## Setup

Requirements: macOS, Node 20+, Tailscale (the phone and the Mac on the same tailnet), OpenClaw with its gateway exposed through Tailscale Serve (`tailscale serve` on port 443 to `127.0.0.1:18789`), and the `openclaw` CLI.

1. `cp .env.example .env` and fill in:
   - `ANO_PAIR_TAILNET_IP` (required): this Mac's tailnet IPv4, from `tailscale ip -4`.
   - `ANO_PAIR_ALLOWED_LOGINS` (required): comma-separated Tailscale login names allowed to pair (yours, e.g. `you@example.com`).
   - `ANO_PAIR_MAGICDNS`: this Mac's MagicDNS name (e.g. `my-mac.example-tailnet.ts.net`); the gateway URL defaults to `wss://<this>`. Or set `ANO_PAIR_GATEWAY_URL` directly.
   The service refuses to start without the required values.
2. Run in the foreground: `./ano-pair.sh run` (loads `.env`). Or `npm start` with the variables exported yourself.
3. Optional, run at login: `./ano-pair.sh install` writes the LaunchAgent `~/Library/LaunchAgents/com.ano.pair.plist` with every `ANO_PAIR_*` variable from `.env`. Rerun `install` after changing `.env`.
4. Check: `./ano-pair.sh status`, then `node scripts/e2e-pair.mjs` for a full end-to-end pairing with a throwaway identity.
5. In the app, set `EXPO_PUBLIC_ANO_PAIR_HOST` to the same MagicDNS name (optional; the dev-server host is tried first).

## 1. Overview

```
iPhone (Expo Go)                    Mac                                    OpenClaw gateway
     | 1 GET /.well-known/ano  ----> ano-pair :4391                              |
     | 2 POST /pair {device...} ---> identity check (tailscale whois)            |
     |                               openclaw qr --json --limited (mint) -----> state store
     | <--- bootstrapToken (10 min, single use, limited)                          |
     | 3 wss connect as node, auth.bootstrapToken ------------------------------> silent pairing
     | <--- hello-ok: node deviceToken + operator deviceToken                     |
     | 4 wss connect as operator, auth.deviceToken (forever after) -------------> hello-ok
```

The shared gateway token never leaves the Mac and never enters the ano-pair process. The app ends up holding a per-device, revocable operator token (`operator.read`, `operator.write` in use; the grant also carries `operator.approvals`, `operator.questions`, `operator.talk.secrets`; never `operator.admin`).

## 2. Discovery order in the app

Try in this order, stop at the first that works. A candidate "works" when `GET /.well-known/ano` returns 200 JSON with `service === "ano-pair"` within 2 seconds (use a 2 s timeout per candidate, run steps 2 and 3 in parallel if desired).

1. **Stored URL.** If a `deviceToken` (operator) and `gatewayUrl` are already saved in SecureStore, connect straight to the gateway with them and skip everything else. Only fall through when that connect fails with an auth error that means "re-pair" (section 7), or no credentials are stored.
2. **Dev-server host.** `const hostUri = Constants.expoConfig?.hostUri` (expo-constants). In a dev bundle in Expo Go it is `host:port` of the Metro server that served the bundle, e.g. `100.64.0.10:8083`. Take the host part (strip the port, handle IPv6 brackets) and call `http://<host>:4391/.well-known/ano`. `hostUri` is undefined in production builds; then skip this step.
3. **MagicDNS.** `http://<EXPO_PUBLIC_ANO_PAIR_HOST>:4391/.well-known/ano`, e.g. `http://my-mac.example-tailnet.ts.net:4391/.well-known/ano`. Skipped when `EXPO_PUBLIC_ANO_PAIR_HOST` is unset in the app.
4. **Manual Settings** (URL and token typed by hand), as today. Last resort only.

Port 4391 is fixed. The app should remember the working `pairUrl` base so later launches try it first when credentials are missing.

The Mac must be reachable on the tailnet (the phone's Tailscale must be connected). The service refuses everything that is not loopback or a tailnet peer.

## 3. Endpoints

All responses are JSON with `Cache-Control: no-store`. Errors: `{ "ok": false, "error": { "code", "message" } }`.

### GET /.well-known/ano

No authentication, no secrets. Response 200:

```json
{
  "service": "ano-pair",
  "version": 1,
  "serviceVersion": "0.1.0",
  "gatewayUrl": "wss://my-mac.example-tailnet.ts.net",
  "pairUrl": "http://100.64.0.10:4391/pair",
  "identityProvider": "tailnet"
}
```

- `version` is the contract version (integer). The app must refuse a version it does not know.
- `pairUrl` is built from the `Host` header the app used, so it is reachable the same way the app just reached the service.
- `gatewayUrl` is the WebSocket URL to use for every gateway connection (Tailscale Serve, `wss`, port 443, no path).

### GET /healthz

`{ "ok": true }`. For monitoring only.

### POST /pair

Request: `Content-Type: application/json`, max 4 KiB.

```json
{
  "deviceId": "<64 lowercase hex: sha256 of the raw 32 byte Ed25519 public key>",
  "publicKey": "<raw 32 byte Ed25519 public key, base64url, no padding>",
  "displayName": "Alex's iPhone",
  "platform": "ios"
}
```

Validation (400 otherwise): `deviceId` is 64 hex; `publicKey` decodes to exactly 32 bytes and `sha256(publicKey) === deviceId` (code `device_id_mismatch`); `platform` is `ios` or `ipados` (`unsupported_platform`); `displayName` is optional, trimmed to 64 characters.

Success 200:

```json
{
  "ok": true,
  "version": 1,
  "issueId": "<uuid, for support/audit>",
  "gatewayUrl": "wss://my-mac.example-tailnet.ts.net",
  "bootstrapToken": "<secret, single use, expires at expiresAtMs>",
  "expiresAtMs": 1791834907000,
  "identity": { "provider": "tailnet", "login": "you@example.com", "displayName": "Alex" },
  "redeem": {
    "auth": "bootstrapToken",
    "role": "node", "scopes": [], "clientId": "openclaw-ios", "clientMode": "node",
    "platform": "ios", "deviceFamily": "iphone", "minProtocol": 4, "maxProtocol": 4,
    "thenOperator": { "role": "operator", "scopes": ["operator.read", "operator.write"], "clientMode": "ui" }
  }
}
```

`bootstrapToken` is a 10 minute, single-use, limited-scope credential minted by OpenClaw. It is NOT the shared gateway token. Treat it like a password: keep it in memory only, never log it, never persist it, discard it after step 3.

Failure codes:

| HTTP | `error.code` | Meaning | App behavior |
| --- | --- | --- | --- |
| 400 | `bad_request`, `device_id_mismatch`, `unsupported_platform`, `bad_json` | malformed body | developer error |
| 401 | `unauthenticated` | provider found no identity (future providers) | prompt sign-in |
| 403 | `forbidden` | identity not allowed (not on the tailnet, or another user) | show "this device is not allowed", go to manual Settings |
| 403 | `origin_forbidden`, 400 `bad_host` | browser origin / odd Host | web dev only, see section 8 |
| 415 / 413 | `unsupported_media_type`, `too_large` | bad request shape | developer error |
| 429 | `rate_limited` | limiter; honor `Retry-After` (seconds) | back off, do not loop |
| 502 | `mint_failed` | OpenClaw CLI failed to mint | retry once after a few seconds |
| 503 | `unavailable` | identity provider cannot answer | retry later |

## 4. What the app does after `POST /pair`

Exactly what `scripts/e2e-pair.mjs` does (it is the executable reference):

1. **Redeem the bootstrap token with a node-shaped connect.** Open the WebSocket to `gatewayUrl`, wait for `connect.challenge`, then send `connect` with:
   - `minProtocol: 4, maxProtocol: 4`
   - `client: { id: "openclaw-ios", displayName, version, platform: "ios", deviceFamily: "iphone", mode: "node" }`
   - `role: "node"`, `scopes: []`, `caps: []`, `commands: []`, `permissions: {}`
   - `auth: { bootstrapToken }`
   - `device: { id, publicKey, signature, signedAt: challenge.ts, nonce: challenge.nonce }` where the signature is over the v3 payload `v3|<deviceId>|openclaw-ios|node|node||<signedAt>|<bootstrapToken>|<nonce>|ios|iphone` (scopes field is the empty string; the token field is the bootstrap token).
   This exact shape (official iOS client id, platform `ios`, family `iphone`, node mode, empty scopes) is what makes the gateway pair silently. An operator-shaped connect with a bootstrap token would leave a pending request. Use the values from `redeem` instead of hard-coding them where possible.
2. **Read `hello-ok.auth`.** It has `deviceToken` (role node, scopes `[]`, useless for chat) and `deviceTokens[]`. Pick the entry with `role === "operator"` and persist `{ deviceToken, scopes, gatewayUrl, deviceId }` in SecureStore (same trust level as the Ed25519 seed). Do not persist the node token or the bootstrap token. Close the socket.
3. **Normal operator connection from now on:** `role: "operator"`, `client.mode: "ui"`, `scopes: ["operator.read","operator.write"]`, `auth: { deviceToken: <operator token> }`, v3 payload with the device token in the token field. After each connect store the refreshed `hello-ok.auth.deviceToken` if it differs.
4. Never send the shared gateway token. Remove the Settings token field from the primary flow (keep it as the manual fallback, step 4 of discovery).

Concurrency: guard `POST /pair` with a single in-flight lock in the app. Do not retry a failed redeem with the same bootstrap token if the gateway reported a pairing/auth error; ask `/pair` for a new one (it is rate limited: 4 per device per 10 minutes).

## 5. Identity providers

Interface (`lib/identity.mjs`):

```ts
interface IdentityProvider {
  name: string
  authenticate(ctx: { remoteAddress: string, headers: Record<string,string>, body?: object }):
    Promise<
      | { ok: true, identity: { provider: string, subject: string, login: string, displayName: string } }
      | { ok: false, code: 'unauthenticated' | 'forbidden' | 'unavailable', reason: string }
    >
}
```

- `tailnet` (active, `ANO_PAIR_PROVIDER=tailnet`): resolves the peer IP with `/Applications/Tailscale.app/Contents/MacOS/Tailscale whois --json <ip>` and accepts only a `UserProfile.LoginName` listed in `ANO_PAIR_ALLOWED_LOGINS` (required; exact, case-insensitive). Tagged nodes (no user) and peers outside 100.64.0.0/10 and fd7a:115c:a1e0::/48 are rejected before whois runs. Results are cached 30 s. The Tailscale macOS binary behaves as a CLI only when `TERM` is set, so the service sets `TERM=dumb` for the call (without it launchd runs fail with a non-JSON "GUI failed to start" message).
- `google` (stub, `ANO_PAIR_PROVIDER=google`): fails closed with 503 `unavailable`. Plan: the app sends `Authorization: Bearer <Google ID token>` (expo-auth-session), the provider verifies signature (Google JWKS), `aud`, `iss`, `exp` and `email_verified`, maps the account to an ano user record, and returns the same identity shape. `POST /pair` itself does not change; the app adds one header. Multi-user then also needs per-user gateway scoping, which is future work (today every issued credential is an operator token on the one gateway).
- Swapping a provider touches only `createIdentityProvider`. Credential issuance (`lib/credentials.mjs`, `CredentialIssuer.issue({deviceId})`) is a separate seam.

### Loopback

Loopback peers (127.0.0.1, ::1) cannot be looked up by whois ("peer not found"). Default policy `ANO_PAIR_LOOPBACK=self`: a loopback caller is a process on this Mac, so it is identified as this Mac's own tailnet node (`ANO_PAIR_TAILNET_IP`, owned by the Mac's user) and whois'd as that. This is no weaker than the status quo: any local process of the same user can already read the shared token. Loopback requests carrying `X-Forwarded-For`, `Forwarded` or `X-Real-IP` are refused (a proxy hop must not borrow loopback trust). `ANO_PAIR_LOOPBACK=deny` rejects loopback entirely. Calls to the Mac's own tailnet IP show up with that IP as peer and resolve through whois normally (they resolve to the Mac's owner). LAN peers (10.0.0.x) never resolve and the service does not listen on the LAN address anyway.

## 6. Credential mechanism (decision)

Single-use bootstrap token minted with `openclaw qr --json --limited --no-ascii --url wss://my-mac.example-tailnet.ts.net`, executed by the service (same OS user, minimal environment, serialised, 45 s timeout). The command writes the token directly into OpenClaw's local pairing state; the service only reads the JSON, decodes the setup code, checks `access === "limited"`, and returns `bootstrapToken`, `expiresAtMs`. The fallback (auto-approve a pending request with `openclaw devices approve`) was not needed.

Properties and honest limits:
- 10 minute lifetime, single use, bound to the first device identity that redeems it. It is not pre-bound to the `deviceId` at mint time; the service ties every issuance to the requested `deviceId` in the audit log. The transport is plain HTTP, but it only runs over the WireGuard-encrypted tailnet (or loopback).
- Redeeming as `node` also records a node role on the device (scopes `[]`, no commands, grants nothing). Remove it with `openclaw devices revoke --device <id> --role node` if wanted.
- The resulting operator token is bounded (no admin, no pairing mutation) and revocable per device: `openclaw devices revoke|rotate|remove`.

## 7. App failure handling after pairing

| Gateway error | Action |
| --- | --- |
| `AUTH_TOKEN_MISMATCH`, `DEVICE_AUTH_*`, `AUTH_SCOPE_MISMATCH`, `NOT_PAIRED` with the stored deviceToken | token revoked or device removed on the Mac: clear stored credentials and run discovery + `POST /pair` again (once; then show an error) |
| `UNAVAILABLE` `startup-sidecars` | retry after `retryAfterMs` |
| network error | keep the stored credentials, retry with backoff |

## 8. Operations

- Listens only on `127.0.0.1:4391` and `<ANO_PAIR_TAILNET_IP>:4391` (never 0.0.0.0 or the LAN IP; binding any other address is refused at config load). If Tailscale is down at start, the tailnet bind retries every 5 s.
- Host header allowlist (MagicDNS name, tailnet IP, 127.0.0.1, localhost, [::1]) against DNS rebinding. Browser `Origin` headers are refused unless listed in `ANO_PAIR_CORS_ORIGINS` (empty by default; add `http://localhost:8081` to let Expo web call it in dev).
- Rate limits (in memory): 20 `/pair` requests per peer IP per 10 min, 4 credentials per deviceId per 10 min, 30 credentials per hour overall. Env: `ANO_PAIR_LIMIT_IP|DEVICE|GLOBAL`.
- Audit log `run/audit.log` (JSONL, mode 0600, rotates at 1 MB): events `server.listen|stop`, `pair.invalid|denied|rate_limited|error|issued` with `ip`, `deviceId`, `login`, `issueId`, `expiresAtMs`, `reason`. Only an allowlist of non-secret fields is ever written; tokens and setup codes are never logged. `run/service.log` is process stdout/stderr.
- LaunchAgent `com.ano.pair`: `./ano-pair.sh install|uninstall|restart|status|logs|audit|test|run`. No OpenClaw or Tailscale config is touched and the gateway is never restarted.
- Tests: `./ano-pair.sh test` or `npm test` (Node test runner, fake identity provider and fake issuer).
- Executable reference client and end-to-end check: `node scripts/e2e-pair.mjs [--base URL] [--ws URL] [--cleanup]`. Uses a throwaway in-memory identity; `--cleanup` runs `openclaw devices remove <id>`.
- iOS ATS: Expo Go allows cleartext HTTP to the dev host. A standalone/TestFlight build would need an ATS exception for `http://` to the tailnet name or a TLS front for ano-pair (not needed for the Expo Go phase).

## 9. Verification (2026-10-12)

- Unit tests pass.
- `curl http://<ANO_PAIR_TAILNET_IP>:4391/.well-known/ano` and `http://127.0.0.1:4391/...` return the discovery document; the LAN IP on port 4391 refuses the connection; hostile Host and Origin headers are rejected.
- End-to-end with throwaway identities, no shared token: discovery, `POST /pair` (200, identity = the allowlisted owner), node-shaped redeem -> `hello-ok` with node token plus operator token (`operator.approvals`, `operator.questions`, `operator.read`, `operator.talk.secrets`, `operator.write`), operator reconnect with device token only -> `hello-ok` (scopes read+write), `agents.list` ok, `sessions.delete` refused with `missing scope: operator.admin`. Run via the tailnet IP + real `wss://my-mac.example-tailnet.ts.net`, via loopback + `ws://127.0.0.1:18789`, and via the MagicDNS name. Throwaway devices removed with `openclaw devices remove`; the device list is back to its original entries, no pending requests.
- Not tested: a real iPhone reaching port 4391 over the tailnet (the Mac firewall is disabled, so nothing should block it), and a tailnet peer owned by another user (covered by unit tests with a fake whois).
