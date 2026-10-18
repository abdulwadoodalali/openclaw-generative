// Registers the generative UI with CopilotKit and keeps the component registry in sync with the
// conversation. Mounted once inside <AnoProvider> (see src/app/_layout.tsx); renders nothing itself.
//
//   render_<Name>      one render-only renderer per built-in (nothing is advertised to a model, and no
//                      handler runs: CopilotKit only executes tools that were added with a handler).
//                      Components the agent defines at runtime have no renderer; ToolCallSlot draws
//                      them from the registry.
//   define_component   frontend tool. Its handler is a no-op safety net: the definition is normally
//                      applied as soon as its tool call is complete (DefinitionIngest), because the
//                      handler only runs after the whole run ended and never for history.
//
// Tool call status: render-only calls never get a tool result, so CopilotKit reports them as
// "inProgress" forever. A call is still streaming only while it has no args yet.
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { View } from 'react-native';
import { useFrontendTool, useRenderTool } from '@copilotkit/react-native/headless';
import { Skeleton, Text } from '@/components/ui';
import { kvGet, kvSet } from '../storage';
import { useAno, useChat } from '../state/AnoProvider';
import { CODE_BUILTINS } from './builtins/codeMeta.ts';
import { BUILTIN_DEFINITIONS } from './builtins/definitions.ts';
import { GenUiToolCall } from './GenUiToolCall';
import { rebuildDefinitions } from './historyIngest.ts';
import { genuiDefinitions, genuiRegistry, genuiRegistryReady } from './registryInstance';
import { DEFINE_TOOL_NAME, RENDER_TOOL_PREFIX, isFallbackArgs } from './types.ts';

const REBUILD_FLAG_KEY = 'ano.genui.registryRebuilt';

/** Props arrive as free-form JSON; the registry validated them before the tool call was emitted. */
const PermissiveParams = z.object({}).passthrough();

const BUILTIN_NAMES: string[] = [...BUILTIN_DEFINITIONS.map((d) => d.name), ...CODE_BUILTINS.map((m) => m.name)];

export function GenUiRegistrar() {
  return (
    <>
      {BUILTIN_NAMES.map((name) => (
        <BuiltinRenderer key={name} name={name} />
      ))}
      <DefineComponentTool />
      <DefinitionIngest />
    </>
  );
}

/** Hooks cannot run in a loop, so each built-in gets its own tiny registering component. */
function BuiltinRenderer({ name }: { name: string }) {
  useRenderTool(
    {
      name: `${RENDER_TOOL_PREFIX}${name}`,
      parameters: PermissiveParams,
      render: ({ parameters, status, toolCallId }) => (
        <GenUiToolCall name={name} args={parameters} toolCallId={toolCallId} pending={status === 'inProgress' && Object.keys(parameters).length === 0} />
      ),
    },
    [name],
  );
  return null;
}

function DefineComponentTool() {
  useFrontendTool({
    name: DEFINE_TOOL_NAME,
    description: 'Defines a new UI component from data (an ano-define block). Applied by the app, never sent to a model.',
    parameters: PermissiveParams,
    followUp: false,
    handler: async (args) => genuiDefinitions.define(args).summary,
    render: ({ args }) => <DefineChip args={args} />,
  });
  return null;
}

/** Quiet one-line note under a message that defined a component. */
function DefineChip({ args }: { args: Record<string, unknown> }) {
  useSyncExternalStore(genuiDefinitions.subscribe, genuiDefinitions.getVersion, genuiDefinitions.getVersion);
  const name = typeof args.name === 'string' ? args.name : 'a component';
  const outcome = Object.keys(args).length === 0 ? undefined : genuiDefinitions.outcomeFor(args);
  const text = outcome === undefined ? null : outcome.ok ? `New component: ${name}` : `Could not define ${isFallbackArgs(args) ? 'a component' : name}: ${outcome.error}`;
  return (
    <View className="self-start rounded-chip bg-secondary px-2 py-[3px]" accessibilityRole="text">
      {text === null ? <Skeleton className="h-3 w-28" /> : <Text variant="caption">{text}</Text>}
    </View>
  );
}

/** Keeps the registry current: live messages, reopened threads, and the one-time install rebuild. */
function DefinitionIngest() {
  const { agent } = useChat();
  const { gateway, connection, threads } = useAno();
  const rebuilding = useRef(false);

  // Definitions in the message list (streaming, MESSAGES_SNAPSHOT) are applied the moment their tool
  // call is complete, before the component that uses them is drawn.
  useEffect(() => {
    genuiDefinitions.ingestMessages(agent.messages);
    const subscription = agent.subscribe({ onMessagesChanged: ({ messages }) => genuiDefinitions.ingestMessages(messages) });
    return () => subscription.unsubscribe();
  }, [agent]);

  // Fresh install: the registry is empty but old threads hold ano-define fences. Once per install.
  const connected = connection.status === 'ready';
  useEffect(() => {
    if (!connected || !threads.loaded || rebuilding.current) return;
    rebuilding.current = true;
    void (async () => {
      try {
        await genuiRegistryReady;
        if (await kvGet(REBUILD_FLAG_KEY)) return;
        if (!genuiRegistry.hasUserDefinitions) {
          const newestFirst = [...threads.threads].sort((a, b) => b.updatedAt - a.updatedAt);
          const scanned = await rebuildDefinitions({
            threads: newestFirst,
            fetchHistory: (sessionKey) => gateway.request('chat.history', { sessionKey, limit: 200 }),
            ingestor: genuiDefinitions,
          });
          // Nothing could be fetched (connection dropped): try again on the next connect.
          if (scanned === 0 && newestFirst.length > 0) return;
        }
        await kvSet(REBUILD_FLAG_KEY, '1');
      } finally {
        rebuilding.current = false;
      }
    })();
  }, [connected, threads.loaded, threads.threads, gateway]);

  return null;
}
