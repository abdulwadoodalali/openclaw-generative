#!/usr/bin/env node
// ano-pair: tiny pairing service for the Ano iPhone app. Zero dependencies.
// Listens ONLY on loopback and the Tailscale IP. See PAIRING.md.
import http from 'node:http';
import { loadConfig, assertSafeBindAddress } from './lib/config.mjs';
import { AuditLog } from './lib/audit.mjs';
import { createIdentityProvider } from './lib/identity.mjs';
import { OpenClawQrIssuer } from './lib/credentials.mjs';
import { createApp } from './lib/app.mjs';

const config = loadConfig();
const audit = new AuditLog({ file: config.auditFile });
const identityProvider = createIdentityProvider(config);
const issuer = new OpenClawQrIssuer({ bin: config.openclawBin, gatewayUrl: config.gatewayUrl, timeoutMs: config.mintTimeoutMs });
const app = createApp({ config, identityProvider, issuer, audit });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const servers = [];

function listen(addr) {
  assertSafeBindAddress(addr);
  const allowed = new Set(config.bindAddresses);
  const server = http.createServer((req, res) => {
    // Defence in depth: only answer on the addresses we meant to bind.
    if (!allowed.has(req.socket.localAddress)) return req.socket.destroy();
    app(req, res);
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return new Promise((resolve) => {
    const attempt = () => {
      server.once('error', (e) => {
        log(`listen ${addr}:${config.port} failed: ${e.code}; retrying in 5s`);
        setTimeout(attempt, 5000);
      });
      server.listen({ host: addr, port: config.port }, () => {
        server.removeAllListeners('error');
        server.on('error', (e) => log('server error', e.code));
        servers.push(server);
        audit.write('server.listen', { listen: `${addr}:${config.port}`, version: 1 });
        log(`listening on ${addr}:${config.port}`);
        resolve();
      });
    };
    attempt();
  });
}

// Do not block loopback on the tailnet address (Tailscale may come up after login).
for (const addr of config.bindAddresses) void listen(addr);

const stop = () => {
  audit.write('server.stop');
  for (const s of servers) s.close();
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
