// Getting agent-defined components into the registry from places where CopilotKit never runs the
// `define_component` handler: a thread reopened from history (MESSAGES_SNAPSHOT), a definition
// that arrived while the screen was already showing it, and a fresh install that has to rebuild
// the registry from old threads. Pure TypeScript (the registry is injected).
import { z } from 'zod';
import { extractText } from '../openclaw/text.ts';
import { decodeFence, parseSegments } from './fences.ts';
import type { DefineResult } from './registry.ts';
import { DEFINE_TOOL_NAME, isFallbackArgs } from './types.ts';

/** What the ingestor needs from a registry. */
export type DefineSink = { define(input: unknown): DefineResult };

/** Result of offering one definition to the registry. `summary` is the tool result string. */
export type DefineOutcome = { ok: true; summary: string } | { ok: false; error: string; summary: string };

const MAX_REMEMBERED_OUTCOMES = 500;

const ToolCallsSchema = z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }));

/**
 * Feeds `define_component` calls to the registry exactly once per distinct definition. The same
 * definition text always yields the same outcome, so a message list that is re-scanned on every
 * streamed delta, a CopilotKit handler that runs afterwards, and a reopened thread never define
 * twice (a definition with `replace: true` would otherwise bump the catalog version every time).
 */
export class DefinitionIngestor {
  private readonly sink: DefineSink;
  private readonly outcomes = new Map<string, DefineOutcome>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(sink: DefineSink) {
    this.sink = sink;
  }

  /** Bumps whenever a new outcome is recorded (useSyncExternalStore snapshot). */
  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The recorded outcome of a definition, or undefined when it was not offered to the registry yet. */
  outcomeFor(args: unknown): DefineOutcome | undefined {
    return this.outcomes.get(JSON.stringify(args));
  }

  /** Offer one definition (tool call arguments). Fallback args are never defined. */
  define(args: unknown): DefineOutcome {
    const key = JSON.stringify(args);
    const known = this.outcomes.get(key);
    if (known) return known;
    let outcome: DefineOutcome;
    if (isFallbackArgs(args)) {
      outcome = { ok: false, error: args.__error, summary: `Skipped: ${args.__error}` };
    } else {
      const result = this.sink.define(args);
      if (result.ok) {
        const verb = result.changed ? 'Defined' : 'Already had';
        outcome = { ok: true, summary: `${verb} ${result.entry.name} v${result.entry.version}` };
      } else {
        outcome = { ok: false, error: result.error, summary: `Rejected: ${result.error}` };
      }
    }
    this.outcomes.set(key, outcome);
    if (this.outcomes.size > MAX_REMEMBERED_OUTCOMES) {
      const oldest = this.outcomes.keys().next();
      if (!oldest.done) this.outcomes.delete(oldest.value);
    }
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
    return outcome;
  }

  /**
   * Defines every complete `define_component` call found in the messages, in message order.
   * Calls whose arguments are still streaming (empty or unparsable) are left for a later pass.
   */
  ingestMessages(messages: ReadonlyArray<object>): void {
    for (const message of messages) {
      if (!('toolCalls' in message)) continue;
      const calls = ToolCallsSchema.safeParse(message.toolCalls);
      if (!calls.success) continue;
      for (const call of calls.data) {
        if (call.function.name !== DEFINE_TOOL_NAME || !call.function.arguments) continue;
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          continue;
        }
        this.define(args);
      }
    }
  }
}

/** Complete `ano-define` fences of one assistant text, as definition inputs, in order. */
export function definitionsInText(text: string): unknown[] {
  const found: unknown[] = [];
  for (const segment of parseSegments(text, { final: true })) {
    if (segment.kind !== 'define' || !segment.complete) continue;
    const decoded = decodeFence(segment);
    if (decoded.ok) found.push(decoded.call.args);
  }
  return found;
}

/** Texts of the assistant rows of a `chat.history` result, oldest first. */
export function assistantTextsOf(history: unknown): string[] {
  if (typeof history !== 'object' || history === null || !('messages' in history) || !Array.isArray(history.messages)) return [];
  const texts: string[] = [];
  for (const row of history.messages) {
    if (typeof row !== 'object' || row === null || !('role' in row) || row.role !== 'assistant') continue;
    const text = extractText(row);
    if (text) texts.push(text);
  }
  return texts;
}

export const REBUILD_MAX_THREADS = 30;

/**
 * Fresh install: rebuild the registry from old threads. `threads` is the thread list as the app
 * shows it (newest first); the newest `maxThreads` are fetched one by one and replayed oldest
 * first, so a later version of a component wins over an earlier one. Returns how many threads
 * were scanned. A thread whose history cannot be fetched is skipped.
 */
export async function rebuildDefinitions(opts: {
  threads: ReadonlyArray<{ key: string }>;
  fetchHistory: (sessionKey: string) => Promise<unknown>;
  ingestor: DefinitionIngestor;
  maxThreads?: number;
}): Promise<number> {
  const picked = opts.threads.slice(0, opts.maxThreads ?? REBUILD_MAX_THREADS).reverse();
  let scanned = 0;
  for (const thread of picked) {
    let history: unknown;
    try {
      history = await opts.fetchHistory(thread.key);
    } catch {
      continue;
    }
    scanned += 1;
    for (const text of assistantTextsOf(history)) {
      for (const definition of definitionsInText(text)) opts.ingestor.define(definition);
    }
  }
  return scanned;
}
