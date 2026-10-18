// Canvas runners: one per canvas, living outside React so Home tiles can refresh, runs survive
// navigation and several screens see the same state. A runner owns one OpenClawAgent running in the
// canvas's own OpenClaw session (created lazily under the canvas agent's OpenClaw agent, on the
// canvas agent's model). Every outgoing turn carries the current canvas (buildCanvasContext) in front
// of the catalog brief; when the run ends, the ```ano-canvas fences the agent wrote (tool calls named
// CANVAS_TOOL_NAME) are validated and applied to the canvas store as a new version.
//
// Three kinds of turn: 'edit' (the composer) and 'event' (a tap inside the canvas) only run on an
// unlocked canvas; 'refresh' runs on any canvas and, on a locked one, may only change values
// (applyUpdate keepLayout). A run keeps going when its screen unmounts and its result is still
// applied: only stop() aborts it. Pure TypeScript (no react / expo): the app wiring is in instance.ts.
import { stripMarkers } from '../genui/proseMarkers.ts';
import { CANVAS_TOOL_NAME } from '../genui/types.ts';
import {
  OpenClawAgent,
  defaultHooks,
  type GatewayLike,
  type OpenClawAgentHooks,
  type RunActivity,
  type RunMode,
} from '../openclaw/OpenClawAgent.ts';
import { createThread } from '../openclaw/sessionsApi.ts';
import { REFRESH_PROMPT, buildCanvasContext, parseCanvasUpdate, stripCanvasContext, type CanvasTurnMode } from './protocol.ts';
import type { CanvasStore } from './store.ts';
import { isPlainObject } from './types.ts';

export type CanvasRunState = {
  running: boolean;
  kind: CanvasTurnMode | null;
  activity: RunActivity | null;
  error: string | null;
  /** The latest change Ano made; drives the undo toast. Cleared when the next turn starts. */
  lastChange: { summary: string; version: number } | null;
  /** The last edit request (the composer, not a refresh or a tap) and Ano's reply to it; null reply while it runs. Drives the Customize sheet. */
  exchange: { request: string; reply: string | null } | null;
};

export type CanvasRunnerDeps = {
  gateway: GatewayLike;
  /** The OpenClaw agent a canvas runs under when its agent has no agentId (settings.agentId). */
  getDefaultAgentId(): string;
  createId(): string;
  store: CanvasStore;
  /** App hooks (catalog preamble, fence transformer). Default: plain text. */
  hooks?: Partial<OpenClawAgentHooks>;
  /** Fed every message change, so definitions Ano made during a turn reach the registry. */
  ingestMessages?(messages: ReadonlyArray<object>): void;
  /** Awaited before the first turn (persisted catalog state). */
  ready?: Promise<unknown>;
};

export const LOCKED_ERROR = 'Unlock the canvas to change it';

const IDLE_STATE: CanvasRunState = { running: false, kind: null, activity: null, error: null, lastChange: null, exchange: null };
const MAX_REPLY_CHARS = 280;
const RUN_MODES: readonly string[] = ['waiting', 'thinking', 'working', 'answering'];

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The activity the agent publishes in its AG-UI state (`state.activity`), or null. */
function readActivity(state: unknown): RunActivity | null {
  if (!isPlainObject(state) || !isPlainObject(state.activity)) return null;
  const { mode, note, step, model } = state.activity;
  if (typeof mode !== 'string' || !RUN_MODES.includes(mode)) return null;
  const runMode: RunMode = mode === 'thinking' || mode === 'working' || mode === 'answering' ? mode : 'waiting';
  return { mode: runMode, note: optionalString(note), step: optionalString(step), model: optionalString(model) };
}

/** The tool-call arguments as the object the transformer serialized (a JSON string, or already an object). */
function readArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { __fallback: raw, __error: 'the ano-canvas block was not valid JSON' };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export class CanvasRunner {
  readonly id: string;

  private readonly registry: CanvasRunners;
  private state: CanvasRunState = IDLE_STATE;
  private agent: OpenClawAgent | null = null;
  private mode: CanvasTurnMode = 'edit';
  private busy = false;
  private stopped = false;
  /** The model last written to a session with sessions.patch (null = reset to the agent default). */
  private applied: { key: string; model: string | null } | null = null;

  constructor(id: string, registry: CanvasRunners) {
    this.id = id;
    this.registry = registry;
  }

  /** The same object until the state changes (useSyncExternalStore). */
  getState(): CanvasRunState {
    return this.state;
  }

  /** One "edit by asking" turn. An error while the canvas is locked. */
  send(text: string): Promise<void> {
    return this.run('edit', text);
  }

  /** A [ui-event] from a component inside the canvas: the same kind of turn as send. */
  sendUiEvent(text: string): Promise<void> {
    return this.run('event', text);
  }

  /** Re-reads the canvas's data. Allowed locked or unlocked; locked keeps the layout. Marks the canvas refreshed on success. */
  refresh(): Promise<void> {
    return this.run('refresh', REFRESH_PROMPT);
  }

  /** Aborts the run; nothing is applied. */
  stop(): void {
    if (!this.busy) return;
    this.stopped = true;
    this.agent?.abortRun();
  }

  clearError(): void {
    if (this.state.error !== null) this.update({ error: null });
  }

  private update(patch: Partial<CanvasRunState>): void {
    this.state = { ...this.state, ...patch };
    this.registry.notify();
  }

  private getAgent(deps: CanvasRunnerDeps): OpenClawAgent {
    if (this.agent) return this.agent;
    const base: OpenClawAgentHooks = { ...defaultHooks, ...deps.hooks };
    const agent = new OpenClawAgent(deps.gateway, {
      ...base,
      // The canvas context goes first (read from the store at send time, so it is never stale).
      decorateOutgoing: (text, ctx) => {
        const decorated = base.decorateOutgoing(text, ctx);
        const canvas = deps.store.get(this.id);
        return canvas ? buildCanvasContext(canvas, this.mode) + decorated : decorated;
      },
      cleanIncoming: (text) => base.cleanIncoming(stripCanvasContext(text)),
    });
    agent.subscribe({
      onStateChanged: ({ state }) => {
        if (this.busy) this.update({ activity: readActivity(state) });
      },
      onMessagesChanged: ({ messages }) => deps.ingestMessages?.(messages),
    });
    this.agent = agent;
    return agent;
  }

  /**
   * The canvas's session: created on first use under the canvas agent's OpenClaw agent, and put on
   * the canvas agent's model whenever that differs from what the session was last given.
   */
  private async ensureSession(deps: CanvasRunnerDeps, agent: OpenClawAgent): Promise<void> {
    const canvas = deps.store.get(this.id);
    if (!canvas) throw new Error('This canvas no longer exists');
    const request = (method: string, params?: Record<string, unknown>) => deps.gateway.request(method, params);
    let key = canvas.sessionKey;
    let created = false;
    if (!key) {
      const thread = await createThread(request, {
        agentId: canvas.agent.agentId ?? deps.getDefaultAgentId(),
        title: `Canvas: ${canvas.title}`,
        project: 'Canvases',
      });
      key = thread.key;
      created = true;
      deps.store.setSessionKey(this.id, key);
    }
    const model = deps.store.get(this.id)?.agent.model ?? null;
    // A new session starts on the agent default; an existing one we have not touched in this app run is unknown.
    const current = created ? null : this.applied?.key === key ? this.applied.model : undefined;
    if (current !== model) {
      try {
        await request('sessions.patch', { key, model });
      } catch (e) {
        throw new Error(model ? `Could not switch to ${model}: ${errorMessage(e, 'the gateway refused')}` : `Could not reset the model: ${errorMessage(e, 'the gateway refused')}`);
      }
    }
    this.applied = { key, model };
    if (agent.threadId !== key) agent.selectThread(key);
  }

  /** Applies the canvas_update calls of the turn's assistant messages; returns what to tell the user when nothing changed, and Ano's own words. */
  private applyTurn(
    deps: CanvasRunnerDeps,
    kind: CanvasTurnMode,
    turnMessages: ReadonlyArray<unknown>,
  ): { change: { summary: string; version: number } | null; problem: string | null; reply: string } {
    let change: { summary: string; version: number } | null = null;
    let problem: string | null = null;
    let prose = '';
    let calls = 0;
    for (const message of turnMessages) {
      if (!isPlainObject(message) || message.role !== 'assistant') continue;
      if (typeof message.content === 'string') prose += `${prose ? '\n\n' : ''}${stripMarkers(message.content).trim()}`;
      const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
      for (const call of toolCalls) {
        if (!isPlainObject(call) || !isPlainObject(call.function) || call.function.name !== CANVAS_TOOL_NAME) continue;
        calls += 1;
        const parsed = parseCanvasUpdate(readArguments(call.function.arguments));
        if (!parsed.ok) {
          problem = `Ano's change could not be applied: ${parsed.error}`;
          continue;
        }
        const keepLayout = kind === 'refresh' && deps.store.get(this.id)?.locked === true;
        const result = deps.store.applyUpdate(this.id, parsed.update, 'ano', { keepLayout });
        if (!result.ok) {
          problem = `Ano's change could not be applied: ${result.error}`;
          continue;
        }
        change = { summary: result.canvas.summary, version: result.canvas.version };
      }
    }
    const reply = prose.length > MAX_REPLY_CHARS ? `${prose.slice(0, MAX_REPLY_CHARS)}...` : prose;
    if (change) return { change, problem: null, reply };
    if (calls > 0) return { change: null, problem, reply };
    return { change: null, problem: prose || (kind === 'refresh' ? 'Ano did not refresh the canvas' : 'Ano did not change the canvas'), reply };
  }

  private async run(kind: CanvasTurnMode, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;
    let deps: CanvasRunnerDeps;
    try {
      deps = this.registry.requireDeps();
    } catch (e) {
      this.update({ error: errorMessage(e, 'Canvases are not ready yet') });
      return;
    }
    this.busy = true;
    this.stopped = false;
    this.mode = kind;
    this.update({
      running: true,
      kind,
      activity: null,
      error: null,
      lastChange: null,
      ...(kind === 'edit' ? { exchange: { request: trimmed, reply: null } } : {}),
    });
    const failure = { message: null as string | null };
    let failureWatch: { unsubscribe(): void } | null = null;
    try {
      await Promise.all([deps.store.ready, deps.ready]);
      const canvas = deps.store.get(this.id);
      if (!canvas) throw new Error('This canvas no longer exists');
      if (kind !== 'refresh' && canvas.locked) throw new Error(LOCKED_ERROR);
      const agent = this.getAgent(deps);
      await this.ensureSession(deps, agent);
      if (this.stopped) return; // the user pressed stop while the session was being prepared
      failureWatch = agent.subscribe({
        onRunErrorEvent: ({ event }) => {
          failure.message = event.message || 'Something went wrong';
        },
        onRunFailed: ({ error }) => {
          failure.message = error.message || 'Something went wrong';
        },
      });
      const before = agent.messages.length;
      agent.addMessage({ id: deps.createId(), role: 'user', content: trimmed });
      try {
        await agent.runAgent();
      } catch (e) {
        failure.message ??= errorMessage(e, 'Something went wrong');
      }
      if (this.stopped) return; // no verdict, nothing applied
      if (failure.message) {
        this.update({ error: failure.message });
        return;
      }
      const outcome = this.applyTurn(deps, kind, agent.messages.slice(before));
      if (kind === 'edit') this.update({ exchange: { request: trimmed, reply: outcome.reply || outcome.change?.summary || null } });
      if (outcome.change) {
        if (kind === 'refresh') deps.store.markRefreshed(this.id);
        this.update({ lastChange: outcome.change });
      } else {
        this.update({ error: outcome.problem });
      }
    } catch (e) {
      if (!this.stopped) this.update({ error: errorMessage(e, 'Could not send the message') });
    } finally {
      failureWatch?.unsubscribe();
      this.busy = false;
      this.update({ running: false, activity: null });
    }
  }
}

/** The per-canvas runners of the app. `init` once at startup; `get` creates runners on demand. */
export class CanvasRunners {
  private deps: CanvasRunnerDeps | null;
  private readonly runners = new Map<string, CanvasRunner>();
  private readonly listeners = new Set<() => void>();

  constructor(deps: CanvasRunnerDeps | null = null) {
    this.deps = deps;
  }

  init(deps: CanvasRunnerDeps): void {
    this.deps = deps;
  }

  get(id: string): CanvasRunner {
    let runner = this.runners.get(id);
    if (!runner) {
      runner = new CanvasRunner(id, this);
      this.runners.set(id, runner);
    }
    return runner;
  }

  /** Any runner's state changed. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** @internal Called by runners. */
  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** @internal Called by runners at run time. */
  requireDeps(): CanvasRunnerDeps {
    if (!this.deps) throw new Error('Canvases are not ready yet');
    return this.deps;
  }
}

// Fast refresh re-runs this module and would leave a fresh registry with no deps (AnoProvider inits
// once), so canvases would fail with "not ready" until a full reload. The app's deps are kept on
// globalThis and handed to the new registry.
const DEPS_KEY = Symbol.for('ano.canvasRunnerDeps');
const kept = globalThis as unknown as Record<symbol, CanvasRunnerDeps | undefined>;

export const canvasRunners = new CanvasRunners(kept[DEPS_KEY] ?? null);

/** Wires the app's runners (once, from AnoProvider via instance.ts). */
export function initCanvasRunners(deps: CanvasRunnerDeps): void {
  kept[DEPS_KEY] = deps;
  canvasRunners.init(deps);
}
