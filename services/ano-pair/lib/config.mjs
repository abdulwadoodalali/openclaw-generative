// Configuration for ano-pair, read from the environment (see .env.example).
// ANO_PAIR_TAILNET_IP, ANO_PAIR_ALLOWED_LOGINS and a gateway URL (ANO_PAIR_GATEWAY_URL or ANO_PAIR_MAGICDNS) are required.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const SERVICE_VERSION = '0.1.0';
export const CONTRACT_VERSION = 1;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const list = (v, dflt) =>
  v === undefined || v === '' ? dflt : v.split(',').map((s) => s.trim()).filter(Boolean);
const int = (v, dflt) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/** True for IPv4 100.64.0.0/10 (Tailscale CGNAT range). */
export function isTailnetIPv4(ip) {
  if (net.isIPv4(ip) !== true) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}
export function isTailnetIPv6(ip) {
  return net.isIPv6(ip) && ip.toLowerCase().startsWith('fd7a:115c:a1e0:');
}
export function isLoopback(ip) {
  if (net.isIPv4(ip)) return ip.startsWith('127.');
  return ip === '::1';
}

/** Refuse to ever listen on anything but loopback or the Tailscale range (never 0.0.0.0, never the LAN IP). */
export function assertSafeBindAddress(addr) {
  if (isLoopback(addr) || isTailnetIPv4(addr) || isTailnetIPv6(addr)) return addr;
  throw new Error(`refusing to bind ${addr}: only loopback and Tailscale (100.64.0.0/10) addresses are allowed`);
}

export function loadConfig(env = process.env) {
  const port = int(env.ANO_PAIR_PORT, 4391);
  const missing = (name, hint) => {
    throw new Error(`ano-pair: ${name} is required (${hint}); see services/ano-pair/.env.example`);
  };
  const tailnetIp = env.ANO_PAIR_TAILNET_IP || missing('ANO_PAIR_TAILNET_IP', "this Mac's Tailscale IPv4, from `tailscale ip -4`");
  if (!isTailnetIPv4(tailnetIp)) throw new Error(`ano-pair: ANO_PAIR_TAILNET_IP=${tailnetIp} is not a Tailscale (100.64.0.0/10) IPv4 address`);
  const allowedLogins = list(env.ANO_PAIR_ALLOWED_LOGINS, []).map((s) => s.toLowerCase());
  if (allowedLogins.length === 0) missing('ANO_PAIR_ALLOWED_LOGINS', 'comma-separated Tailscale login names allowed to pair');
  const magicDns = (env.ANO_PAIR_MAGICDNS || '').toLowerCase(); // optional, e.g. my-mac.example-tailnet.ts.net
  const gatewayUrl = env.ANO_PAIR_GATEWAY_URL || (magicDns ? `wss://${magicDns}` : missing('ANO_PAIR_GATEWAY_URL', 'or set ANO_PAIR_MAGICDNS to derive wss://<magicdns>'));
  const bindAddresses = list(env.ANO_PAIR_BIND, ['127.0.0.1', tailnetIp]).map(assertSafeBindAddress);
  const runDir = env.ANO_PAIR_RUN_DIR || path.join(ROOT, 'run');
  return {
    port,
    bindAddresses,
    tailnetIp,
    magicDns,
    gatewayUrl,
    // Host header allowlist (DNS rebinding defence). Ports are ignored.
    allowedHosts: [...new Set([...list(env.ANO_PAIR_ALLOWED_HOSTS, []), ...(magicDns ? [magicDns] : []), tailnetIp, '127.0.0.1', 'localhost', '[::1]'])].map((h) => h.toLowerCase()),
    corsOrigins: list(env.ANO_PAIR_CORS_ORIGINS, []), // empty: browsers are blocked entirely
    provider: env.ANO_PAIR_PROVIDER || 'tailnet',
    allowedLogins,
    tailscaleBin: env.ANO_PAIR_TAILSCALE_BIN || '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    loopback: env.ANO_PAIR_LOOPBACK === 'deny' ? 'deny' : 'self', // see PAIRING.md "Loopback"
    openclawBin: env.ANO_PAIR_OPENCLAW_BIN || '/opt/homebrew/bin/openclaw',
    mintTimeoutMs: int(env.ANO_PAIR_MINT_TIMEOUT_MS, 45000),
    runDir,
    auditFile: env.ANO_PAIR_AUDIT_FILE || path.join(runDir, 'audit.log'),
    limits: {
      ip: { max: int(env.ANO_PAIR_LIMIT_IP, 20), windowMs: 10 * 60_000 }, // all /pair requests per peer IP
      device: { max: int(env.ANO_PAIR_LIMIT_DEVICE, 4), windowMs: 10 * 60_000 }, // credentials per deviceId
      global: { max: int(env.ANO_PAIR_LIMIT_GLOBAL, 30), windowMs: 60 * 60_000 }, // credentials overall
    },
    home: env.HOME || os.homedir(),
  };
}
