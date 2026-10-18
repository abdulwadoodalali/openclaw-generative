// Append-only JSONL audit log. Only an allowlist of non-secret fields is ever written.
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED = new Set([
  'ip', 'deviceId', 'login', 'provider', 'issueId', 'expiresAtMs', 'reason', 'code', 'status',
  'retryAfterMs', 'listen', 'version', 'limit', 'displayName', 'platform', 'exitCode',
]);

export class AuditLog {
  constructor({ file, maxBytes = 1_000_000, now = () => new Date() }) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.now = now;
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }

  write(event, fields = {}) {
    const rec = { ts: this.now().toISOString(), event };
    for (const [k, v] of Object.entries(fields)) {
      if (!ALLOWED.has(k) || v === undefined || v === null) continue;
      rec[k] = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : v;
    }
    if (!this.file) return rec;
    try {
      try {
        if (fs.statSync(this.file).size > this.maxBytes) fs.renameSync(this.file, `${this.file}.1`);
      } catch {}
      fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', { mode: 0o600 });
    } catch (e) {
      console.error('audit write failed:', e.code || 'error');
    }
    return rec;
  }
}
