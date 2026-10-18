// CredentialIssuer: turns "this identity is verified" into a device credential.
// Implementation: mint a single-use, 10 minute, limited-scope OpenClaw bootstrap token with
// `openclaw qr --json --limited`. The shared gateway token never enters this process.
//
//   interface CredentialIssuer { issue({ deviceId }): Promise<{ bootstrapToken, expiresAtMs, gatewayUrl, access }> }
import { execFile } from 'node:child_process';

export class MintError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function parseQrJson(stdout, now = Date.now()) {
  let doc;
  try {
    doc = JSON.parse(stdout);
  } catch {
    throw new MintError('qr output was not JSON');
  }
  if (typeof doc?.setupCode !== 'string') throw new MintError('qr output had no setup code');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(doc.setupCode, 'base64url').toString('utf8'));
  } catch {
    throw new MintError('setup code did not decode');
  }
  const bootstrapToken = payload?.bootstrapToken;
  const expiresAtMs = Number(payload?.expiresAtMs ?? doc.expiresAtMs);
  if (typeof bootstrapToken !== 'string' || bootstrapToken.length < 16) throw new MintError('setup code had no bootstrap token');
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) throw new MintError('bootstrap token already expired');
  // Defence in depth: never hand out an admin-capable code.
  const access = doc.access;
  if (access !== undefined && access !== 'limited') throw new MintError(`refusing non-limited access profile: ${access}`);
  return { bootstrapToken, expiresAtMs, access: access ?? 'limited', gatewayUrl: payload.url || doc.gatewayUrl };
}

export class OpenClawQrIssuer {
  constructor({ bin, gatewayUrl, timeoutMs = 45000, env = process.env, exec = execFile }) {
    this.bin = bin;
    this.gatewayUrl = gatewayUrl;
    this.timeoutMs = timeoutMs;
    this.exec = exec;
    // Minimal env: openclaw needs HOME (state dir) and PATH (node shebang). No gateway secrets forwarded.
    this.env = { HOME: env.HOME, PATH: env.PATH, USER: env.USER, LANG: env.LANG, TMPDIR: env.TMPDIR };
    this.chain = Promise.resolve();
  }

  /** Serialised: one mint at a time. */
  issue(args) {
    const run = this.chain.then(() => this.#mint(args));
    this.chain = run.catch(() => {});
    return run;
  }

  #mint() {
    const argv = ['qr', '--json', '--limited', '--no-ascii', '--url', this.gatewayUrl];
    return new Promise((resolve, reject) => {
      this.exec(this.bin, argv, { env: this.env, timeout: this.timeoutMs, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout) => {
        if (err) return reject(new MintError('openclaw qr failed', typeof err.code === 'number' ? err.code : undefined));
        try {
          const r = parseQrJson(stdout);
          resolve({ ...r, gatewayUrl: this.gatewayUrl });
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}
