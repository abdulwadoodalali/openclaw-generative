// How components that hold other components (Collapsible, the generic fallback card) draw them.
// GenUiToolCall provides the function: it resolves a `{component, props}` instance through the
// registry exactly like a top-level tool call, and caps the nesting depth. Kept in its own module
// so those components do not import GenUiToolCall (which imports them).
import { createContext, useContext, type ReactNode } from 'react';

/** Draws one nested instance. `id` becomes the instance id of its actions. */
export type RenderNode = (component: string, props: Record<string, unknown>, id: string) => ReactNode;

const NodeContext = createContext<RenderNode | null>(null);

export const NodeRendererProvider = NodeContext.Provider;

/** The nearest renderer, or null outside GenUiToolCall. */
export function useRenderNode(): RenderNode | null {
  return useContext(NodeContext);
}
