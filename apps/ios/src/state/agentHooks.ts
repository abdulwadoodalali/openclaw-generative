// Generative UI hooks for OpenClawAgent (src/openclaw/OpenClawAgent.ts), see src/genui/hooks.ts:
//   createTransformer  the fence transformer: ano-ui fences become render_<Name> tool calls (props
//                      validated against the component registry), ano-define fences become
//                      define_component tool calls.
//   decorateOutgoing   prepends the <ano-ui-context> catalog brief to the first message of a thread
//                      (and a [catalog-update] delta when the catalog changed since the thread last
//                      saw it). The typed text stays untouched in the visible AG-UI message.
//   cleanIncoming      strips that preamble again and hides [ui-event] rows when history reloads.
// The per-thread "catalog seen" map is persisted in `ano/catalogSeen.json` (localStorage on web),
// not in the Keychain store: it is far larger than a secure-store value should be. Await
// `catalogSeenReady` before the first send.
import { createGenUiHooks } from '../genui/hooks';
import { genuiRegistry } from '../genui/registryInstance';
import { createJsonFileStorage } from '../genui/registryStorage';
import type { OpenClawAgentHooks } from '../openclaw/OpenClawAgent';

const { hooks, tracker } = createGenUiHooks(genuiRegistry, createJsonFileStorage('catalogSeen.json', 'ano.genui.catalogSeen'));

/** Resolves when the persisted catalog-seen map was read. */
export const catalogSeenReady: Promise<void> = tracker.ready;

export function getAnoAgentHooks(): OpenClawAgentHooks {
  return hooks;
}
