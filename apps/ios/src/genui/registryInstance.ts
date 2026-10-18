// The app-wide component registry: built-ins plus whatever the agent defined in earlier sessions.
// The registry is usable immediately (built-ins need no storage); `genuiRegistryReady` resolves
// once the persisted agent-defined components were restored.
import { CODE_BUILTINS } from './builtins/codeMeta.ts';
import { BUILTIN_DEFINITIONS } from './builtins/definitions.ts';
import { DefinitionIngestor } from './historyIngest.ts';
import { ComponentRegistry } from './registry.ts';
import { createRegistryStorage } from './registryStorage.ts';

export const genuiRegistry = new ComponentRegistry({
  builtins: BUILTIN_DEFINITIONS,
  codeBuiltins: CODE_BUILTINS,
  storage: createRegistryStorage(),
});

export const genuiRegistryReady: Promise<void> = genuiRegistry.load();

/**
 * The single way definitions reach `genuiRegistry` from tool calls (CopilotKit handler, reopened
 * threads, live messages). Sharing one ingestor keeps a definition from being applied twice.
 */
export const genuiDefinitions = new DefinitionIngestor(genuiRegistry);
