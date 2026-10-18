// Where agent tool calls are drawn inside the message list.
//
// MessageBubble renders one <ToolCallSlot> per AG-UI tool call on an assistant message. Renderers
// registered with CopilotKit (GenUiRegistrar: the built-in components and define_component) are
// used first. A `render_<Name>` call without a renderer is a component the agent defined at runtime:
// it is looked up in the component registry, so it appears as soon as its definition landed.
//   args still streaming  -> skeleton
//   FallbackArgs          -> quiet card with the raw fence text
//   not in the registry   -> a generic card built from the props (GenUiFallback)
//   canvas_update         -> its CopilotKit renderer (the canvas chip), nothing when none is registered
import React, { useMemo } from 'react';
import type { ToolCall, ToolMessage } from '@copilotkit/react-native/headless';
import { useRenderToolCall } from '@copilotkit/react-native/headless';
import { GenUiFallback, GenUiSkeleton } from '../genui/components';
import { GenUiToolCall } from '../genui/GenUiToolCall';
import { genuiRegistry } from '../genui/registryInstance';
import { CANVAS_TOOL_NAME, RENDER_TOOL_PREFIX } from '../genui/types.ts';

export type ToolCallSlotProps = {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
};

/** Parsed tool call arguments; undefined while they are still streaming in (empty or cut off). */
function parseArguments(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function ToolCallSlot({ toolCall, toolMessage }: ToolCallSlotProps) {
  const renderToolCall = useRenderToolCall();
  const { name, arguments: rawArgs } = toolCall.function;
  const component = name.startsWith(RENDER_TOOL_PREFIX) ? name.slice(RENDER_TOOL_PREFIX.length) : null;
  const args = useMemo(() => parseArguments(rawArgs), [rawArgs]);

  if (component === null) {
    if (name === CANVAS_TOOL_NAME) return renderToolCall({ toolCall, toolMessage }) ?? null;
    return renderToolCall({ toolCall, toolMessage }) ?? <GenUiFallback name={name} error="unknown tool" />;
  }
  // The fence transformer only sends args once the fence is complete, so empty args mean "drawing".
  if (args === undefined) return <GenUiSkeleton name={component} />;
  // Only built-ins have CopilotKit renderers; asking for a runtime-defined name logs a warning.
  const builtin = genuiRegistry.get(component)?.builtin === true;
  const rendered = builtin ? renderToolCall({ toolCall, toolMessage }) : null;
  return rendered ?? <GenUiToolCall name={component} args={args} toolCallId={toolCall.id} pending={false} />;
}
