// Runtime gaps between modern JS (which @openclaw/gateway-client and @ag-ui assume) and Hermes /
// older WebViews. Imported first from the root layout. Each patch is a no-op where supported.
// CopilotKit installs its own stream/encoding/crypto polyfills when its headless entry loads.

type Resolvers<T> = { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (e?: unknown) => void };

const P = Promise as unknown as { withResolvers?: <T>() => Resolvers<T> };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>(): Resolvers<T> {
    let resolve!: Resolvers<T>['resolve'];
    let reject!: Resolvers<T>['reject'];
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const AS = (globalThis as unknown as { AbortSignal?: { prototype: Record<string, unknown> } }).AbortSignal;
if (AS && typeof AS.prototype.throwIfAborted !== 'function') {
  AS.prototype.throwIfAborted = function throwIfAborted(this: { aborted: boolean; reason?: unknown }) {
    if (this.aborted) throw this.reason ?? new Error('Aborted');
  };
}

export {};
