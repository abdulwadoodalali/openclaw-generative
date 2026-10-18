// IdentityProvider: decides WHO is asking to pair. The rest of the service only sees this interface.
//
//   interface IdentityProvider {
//     name: string
//     authenticate(ctx: PeerContext): Promise<AuthResult>
//   }
//   PeerContext = { remoteAddress: string, headers: Record<string,string>, body?: object }
//   AuthResult  = { ok: true, identity: { provider, subject, login, displayName } }
//               | { ok: false, code: 'unauthenticated' | 'forbidden' | 'unavailable', reason: string }
//
// Providers: `tailnet` (now), `google` (stub, later: Google sign-in issues the user, same interface).
import { execFile } from 'node:child_process';
import net from 'node:net';
import { isLoopback, isTailnetIPv4, isTailnetIPv6 } from './config.mjs';

export function normalizeIp(addr) {
  if (!addr) return '';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

function runWhois(bin, ip, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['whois', '--json', ip], {
      timeout: timeoutMs,
      maxBuffer: 1 << 20,
      windowsHide: true,
      // The macOS Tailscale.app binary acts as a CLI only when TERM is set; under launchd it is not,
      // and without it the binary tries to start the GUI and prints a non-JSON error.
      env: { HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER, TERM: 'dumb' },
    }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export class TailnetIdentityProvider {
  /**
   * @param {object} o
   * @param {string[]} o.allowedLogins exact Tailscale login names, lowercase
   * @param {string} o.selfIp this machine's tailnet IP (used for loopback callers)
   * @param {'self'|'deny'} o.loopback
   * @param {(ip:string)=>Promise<object>} [o.whois] injectable for tests
   */
  constructor({ allowedLogins, selfIp, loopback = 'self', whois, tailscaleBin, cacheMs = 30_000, now = () => Date.now() }) {
    this.name = 'tailnet';
    this.allowedLogins = new Set(allowedLogins.map((s) => s.toLowerCase()));
    this.selfIp = selfIp;
    this.loopback = loopback;
    this.whois = whois || ((ip) => runWhois(tailscaleBin, ip));
    this.cacheMs = cacheMs;
    this.now = now;
    this.cache = new Map();
  }

  async lookup(ip) {
    const hit = this.cache.get(ip);
    if (hit && hit.until > this.now()) return hit.value;
    const value = await this.whois(ip);
    this.cache.set(ip, { value, until: this.now() + this.cacheMs });
    return value;
  }

  async authenticate({ remoteAddress, headers = {} }) {
    let ip = normalizeIp(remoteAddress);
    if (!net.isIP(ip)) return { ok: false, code: 'unauthenticated', reason: 'no peer address' };

    if (isLoopback(ip)) {
      // A loopback peer is a process on this Mac. Never trust a proxied hop pretending to be loopback.
      if (headers['x-forwarded-for'] || headers['forwarded'] || headers['x-real-ip']) {
        return { ok: false, code: 'forbidden', reason: 'proxied loopback request' };
      }
      if (this.loopback !== 'self') return { ok: false, code: 'forbidden', reason: 'loopback not allowed' };
      ip = this.selfIp; // identify as this machine's own tailnet node (owned by the Mac's owner)
    } else if (!(isTailnetIPv4(ip) || isTailnetIPv6(ip))) {
      return { ok: false, code: 'forbidden', reason: 'peer is not on the tailnet' };
    }

    let who;
    try {
      who = await this.lookup(ip);
    } catch (e) {
      // whois says "peer not found" for anything that is not a tailnet node.
      const why = String(e?.stderr || e?.message || 'error').replace(/\s+/g, ' ').slice(0, 120);
      return { ok: false, code: 'forbidden', reason: `tailscale whois failed: ${why}` };
    }
    const login = String(who?.UserProfile?.LoginName || '').toLowerCase();
    const tagged = Array.isArray(who?.Node?.Tags) && who.Node.Tags.length > 0;
    if (!login || tagged) return { ok: false, code: 'forbidden', reason: 'peer has no user identity' };
    if (!this.allowedLogins.has(login)) return { ok: false, code: 'forbidden', reason: 'login not allowed' };
    return {
      ok: true,
      identity: {
        provider: this.name,
        subject: String(who.UserProfile.ID ?? login),
        login,
        displayName: who.UserProfile.DisplayName || login,
      },
    };
  }
}

/**
 * Stub for the future Google sign-in provider. Intended shape:
 *   - app sends `Authorization: Bearer <Google ID token>` (obtained via expo-auth-session)
 *   - verify signature against Google JWKS, check aud/iss/exp, require email_verified
 *   - map the verified email/sub to an ano user record, and apply the same allow rules
 * Until then it fails closed.
 */
export class GoogleIdentityProvider {
  constructor() {
    this.name = 'google';
  }

  async authenticate() {
    return { ok: false, code: 'unavailable', reason: 'google provider not implemented' };
  }
}

export function createIdentityProvider(cfg, overrides = {}) {
  if (cfg.provider === 'tailnet') {
    return new TailnetIdentityProvider({
      allowedLogins: cfg.allowedLogins,
      selfIp: cfg.tailnetIp,
      loopback: cfg.loopback,
      tailscaleBin: cfg.tailscaleBin,
      ...overrides,
    });
  }
  if (cfg.provider === 'google') return new GoogleIdentityProvider();
  throw new Error(`unknown identity provider: ${cfg.provider}`);
}
