// Tiny in-memory sliding-window limiter. One instance per policy.
export class SlidingWindowLimiter {
  constructor({ max, windowMs, now = () => Date.now() }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  /** Consume one slot for key. Returns { ok } or { ok:false, retryAfterMs }. */
  take(key) {
    const t = this.now();
    const arr = (this.hits.get(key) || []).filter((x) => x > t - this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return { ok: false, retryAfterMs: Math.max(1, arr[0] + this.windowMs - t) };
    }
    arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) this.sweep(t);
    return { ok: true };
  }

  sweep(t = this.now()) {
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((x) => x > t - this.windowMs);
      if (kept.length) this.hits.set(k, kept);
      else this.hits.delete(k);
    }
  }
}
