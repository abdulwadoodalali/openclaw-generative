// The app-wide canvas store, persisted to `ano/canvases.json` (localStorage on web), and the wiring of
// the canvas runners to the app (catalog hooks, definition ingestion, the store).
import { genuiDefinitions } from '../genui/registryInstance';
import { createJsonFileStorage } from '../genui/registryStorage';
import type { GatewayLike } from '../openclaw/OpenClawAgent';
import { catalogSeenReady, getAnoAgentHooks } from '../state/agentHooks';
import { initCanvasRunners } from './runner.ts';
import { CanvasStore } from './store.ts';

export const canvasStore = new CanvasStore({ storage: createJsonFileStorage('canvases.json', 'ano.canvases') });

/** Starts the canvas runners on the app's store and hooks. Call once, before any canvas screen renders. */
export function startCanvasRunners(deps: { gateway: GatewayLike; getDefaultAgentId(): string; createId(): string }): void {
  initCanvasRunners({
    ...deps,
    store: canvasStore,
    hooks: getAnoAgentHooks(),
    ingestMessages: (messages) => genuiDefinitions.ingestMessages(messages),
    ready: catalogSeenReady,
  });
}
