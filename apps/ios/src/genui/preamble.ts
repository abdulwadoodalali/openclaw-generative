// Per-thread catalog preamble bookkeeping. The model only knows the components it was told about,
// so the first message of a thread carries the full `<ano-ui-context>` brief and later messages
// carry a `[catalog-update]` delta when the registry changed since that thread last saw it.
// Pure TypeScript (storage is injected, see agentHooks.ts for the app wiring).
import { z } from 'zod';
import { buildCatalogBrief, buildCatalogDelta, decorateUserText, type CatalogSource } from './catalog.ts';

/** Persistence for the seen map; same shape as RegistryStorage. `load` may reject, `save` may reject. */
export type CatalogSeenStorage = {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
};

/** Only the most recent threads are remembered; an older thread gets the brief again. */
export const MAX_SEEN_THREADS = 200;

const SeenSchema = z.array(z.tuple([z.string(), z.number().int().min(0)]));

export type CatalogTracker = {
  /** Resolves when the persisted map was read. Await it before the first send of the app session. */
  readonly ready: Promise<void>;
  /** Resolves when every pending save has finished (tests, app shutdown). */
  flush(): Promise<void>;
  /** The text to send over chat.send: the typed text with brief or delta prepended when needed. */
  decorateOutgoing(text: string, ctx: { sessionKey: string; firstMessage: boolean }): string;
  /** catalogVersion this thread last saw, undefined when it never saw the catalog. */
  seenVersion(sessionKey: string): number | undefined;
};

export function createCatalogTracker(source: CatalogSource, storage: CatalogSeenStorage): CatalogTracker {
  // Insertion order = recency (oldest first); a touched key is re-inserted at the end.
  const seen = new Map<string, number>();
  let pendingSave: Promise<void> = Promise.resolve();

  const persist = () => {
    const json = JSON.stringify([...seen.entries()]);
    // Chained so an older snapshot can never overwrite a newer one; failures only lose bookkeeping.
    pendingSave = pendingSave.then(() => storage.save(json)).catch(() => undefined);
  };

  const record = (sessionKey: string, version: number) => {
    seen.delete(sessionKey);
    seen.set(sessionKey, version);
    while (seen.size > MAX_SEEN_THREADS) {
      const oldest = seen.keys().next();
      if (oldest.done) break;
      seen.delete(oldest.value);
    }
    persist();
  };

  const ready = (async () => {
    try {
      const raw = await storage.load();
      if (raw === null) return;
      const stored = SeenSchema.parse(JSON.parse(raw));
      // Entries recorded before the load finished are newer than anything on disk.
      const fresh = new Map(seen);
      seen.clear();
      for (const [key, version] of stored) seen.set(key, version);
      for (const [key, version] of fresh) {
        seen.delete(key);
        seen.set(key, version);
      }
    } catch {
      // Unreadable or garbage storage: start empty, every thread gets the brief once.
    }
  })();

  return {
    ready,
    flush: () => pendingSave,
    seenVersion: (sessionKey) => seen.get(sessionKey),
    decorateOutgoing(text, { sessionKey, firstMessage }) {
      const version = source.catalogVersion;
      const last = seen.get(sessionKey);
      let brief: string | undefined;
      let delta: string | null = null;
      if (firstMessage || last === undefined) brief = buildCatalogBrief(source);
      else if (version > last) delta = buildCatalogDelta(source, last);
      record(sessionKey, version);
      return decorateUserText(text, { brief, delta });
    },
  };
}
