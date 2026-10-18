// The OpenClawAgent hooks of the generative UI layer, built from a registry and a storage for the
// per-thread "catalog seen" map. Pure TypeScript, so Node tests drive a real agent with exactly the
// hooks the app uses (src/state/agentHooks.ts passes the app singletons).
import type { OpenClawAgentHooks } from '../openclaw/OpenClawAgent.ts';
import { cleanUserText } from './catalog.ts';
import { createFenceTransformer } from './fenceTransformer.ts';
import { createCatalogTracker, type CatalogSeenStorage, type CatalogTracker } from './preamble.ts';
import type { ComponentRegistry } from './registry.ts';

export function createGenUiHooks(
  registry: ComponentRegistry,
  catalogSeen: CatalogSeenStorage,
): { hooks: OpenClawAgentHooks; tracker: CatalogTracker } {
  const tracker = createCatalogTracker(registry, catalogSeen);
  const hooks: OpenClawAgentHooks = {
    createTransformer: (ctx) => createFenceTransformer(ctx, { validate: (component, props) => registry.validateProps(component, props) }),
    decorateOutgoing: tracker.decorateOutgoing,
    cleanIncoming: cleanUserText,
  };
  return { hooks, tracker };
}
