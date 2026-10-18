// OpenClaw to AG-UI adapter. A client-side AbstractAgent: no server, no HTTP runtime.
//
//   chat.send ack            -> RUN_STARTED   (threadId = sessionKey, runId = gateway runId)
//   chat delta               -> TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT   (via the transformer)
//   chat final               -> TEXT_MESSAGE_END + RUN_FINISHED
//   chat error               -> RUN_ERROR
//   chat aborted             -> TEXT_MESSAGE_END + RUN_FINISHED
//   chat.history             -> MESSAGES_SNAPSHOT   (connect(), used when a thread is opened)
//   chat status, agent events -> STATE_SNAPSHOT {activity}   (what the run is doing: the orb)
//   agent `thinking` events + activity steps, history `thinking` / tool call blocks -> processFor(messageId)   (not in the AG-UI messages)
//   setOutgoingAttachments(userMessageId, [...]) -> `attachments` on that message's chat.send
//   run start / mode, deltas, tool start / end, handoffs, outcome -> options.orb(event)   (the global orb, src/orb)
//
// Extension points for build 2 (see handoff/BUILD2.md): `hooks.createTransformer` turns the
// accumulated assistant text into AG-UI events (the fence parser plugs in here and emits
// TOOL_CALL_* events for `ano-ui` blocks), `hooks.decorateOutgoing` prepends the catalog preamble
// to user text, `hooks.cleanIncoming` strips it again when history is reloaded.
//
// This file has no react-native or expo imports so it also runs under Node (live smoke test).
import { AbstractAgent, EventType } from '@ag-ui/client';
import type { BaseEvent, Message, RunAgentInput } from '@ag-ui/client';
import { Observable, type Subscriber } from 'rxjs';
import { mergeChatStreamMessage, type EventFrame } from '@openclaw/gateway-client/browser';
import { extractText, extractThinking, stripPersona } from './text.ts';
import { agentTone } from '../chat/agents.ts';
import type { OrbEvent } from '../orb/orbMachine.ts';

// ---- gateway facing interface (satisfied by GatewayConnection, easy to fake in tests) ---------

export interface GatewayLike {
  request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  onEvent(listener: (event: EventFrame) => void): () => void;
  /** Subscribe to status changes. Used to recover an in-flight run after a reconnect. */
  subscribeStatus(listener: () => void): () => void;
  getInfo(): { status: string; readyCount: number };
}

// ---- extension points -------------------------------------------------------------------------

export type TransformerContext = { messageId: string; runId: string; sessionKey: string };

/** Turns the accumulated raw assistant text of one run into AG-UI events. */
export interface AssistantStreamTransformer {
  /** Called with the FULL text so far, only ever when it extends the previous text. */
  push(fullText: string): BaseEvent[];
  /** The text was rewritten (not an append). Resync internal state to `fullText`, emit nothing. */
  rebase(fullText: string): void;
  /** The run ended. Close any open message. `fullText` is the final text. */
  finish(fullText: string): BaseEvent[];
  /** The complete AG-UI assistant message for `fullText`. Used for history and rewrites. */
  toMessage(fullText: string): Message;
}

export type OpenClawAgentHooks = {
  createTransformer: (ctx: TransformerContext) => AssistantStreamTransformer;
  /** Decorate the user text sent over chat.send (build 2: catalog preamble). Default: identity. */
  decorateOutgoing: (text: string, ctx: { sessionKey: string; firstMessage: boolean }) => string;
  /** Undo decorateOutgoing for a user row loaded from history. `hidden` drops the message. */
  cleanIncoming: (text: string) => { text: string; hidden?: boolean };
};

/** An attachment for `chat.send` (verified: the model sees `type: "image"` content as base64). */
export type OutgoingAttachment = { type: 'image'; mimeType: string; fileName: string; content: string };

/**
 * How an answer came about: the model's thinking and the steps (tools, handoffs) of the run that
 * produced it. `seconds` is how long the thinking took, null when unknown (history rows carry no timing).
 */
export type AnswerProcess = { thinking: string | null; seconds: number | null; steps: Array<{ label: string }> };

/** What a run needs from the agent that owns it. */
type RunHost = {
  now(): number;
  /** The attachments queued for a user message (consumed: a second call returns undefined). */
  takeAttachments(messageId: string): OutgoingAttachment[] | undefined;
  setProcess(messageId: string, process: AnswerProcess): void;
  /** What the orb should know (run mode, tokens, tools, outcome). A no-op unless the app passed `orb`. */
  orb(event: OrbEvent): void;
};

/** How many assistant messages keep their process in memory. The oldest are dropped first. */
const MAX_PROCESS = 300;

/** Default transformer: plain text, one AG-UI assistant message per run. */
export function createPlainTextTransformer(ctx: TransformerContext): AssistantStreamTransformer {
  let emitted = '';
  let started = false;
  let ended = false;
  const start = (): BaseEvent => ({ type: EventType.TEXT_MESSAGE_START, messageId: ctx.messageId, role: 'assistant' }) as BaseEvent;
  return {
    push(fullText) {
      const events: BaseEvent[] = [];
      if (ended || fullText.length <= emitted.length) return events;
      if (!started) {
        events.push(start());
        started = true;
      }
      events.push({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: ctx.messageId,
        delta: fullText.slice(emitted.length),
      } as BaseEvent);
      emitted = fullText;
      return events;
    },
    rebase(fullText) {
      emitted = fullText;
      started = true; // the message exists in the snapshot the agent just emitted
    },
    finish(fullText) {
      const events = this.push(fullText);
      if (started && !ended) {
        events.push({ type: EventType.TEXT_MESSAGE_END, messageId: ctx.messageId } as BaseEvent);
      }
      ended = true;
      return events;
    },
    toMessage(fullText) {
      return { id: ctx.messageId, role: 'assistant', content: fullText } as Message;
    },
  };
}

export const defaultHooks: OpenClawAgentHooks = {
  createTransformer: createPlainTextTransformer,
  decorateOutgoing: (text) => text,
  cleanIncoming: (text) => ({ text }),
};

// ---- helpers ----------------------------------------------------------------------------------

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for runtimes without crypto.randomUUID. Not used for secrets.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type ChatPayload = {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  state?: 'status' | 'delta' | 'final' | 'aborted' | 'error';
  deltaText?: string;
  replace?: boolean;
  message?: unknown;
  errorMessage?: string;
  errorKind?: string;
};

type HistoryResult = {
  messages?: Array<{ role?: string; content?: unknown; __openclaw?: { id?: string }; idempotencyKey?: string }>;
  inFlightRun?: { runId?: string; text?: string };
};

/** `agent` event frames (the gateway sends them because the app advertises `tool-events`). */
type AgentPayload = { runId?: string; sessionKey?: string; stream?: string; data?: Record<string, unknown> };

export type RunMode = 'waiting' | 'thinking' | 'working' | 'answering';

/**
 * What a run is doing right now, published as `agent.state.activity`. `note` is the agent's own
 * progress line ("Ano Finance is on it"), `step` the current tool or handoff, `model` the model
 * that is answering (it changes when the gateway falls back).
 */
export type RunActivity = { mode: RunMode; note: string | null; step: string | null; model: string | null };

const IDLE_ACTIVITY: RunActivity = { mode: 'waiting', note: null, step: null, model: null };

/** Tools whose gateway title says little (keys lowercase). Anything else shows the gateway's own item title. */
const TOOL_STEPS: Record<string, string> = {
  tool_search: 'Looking for the right tool',
  subagents: 'Waiting for a reply',
  sessions_yield: 'Waiting for a reply',
  exec: 'Running a command',
  bash: 'Running a command',
  shell: 'Running a command',
  skill: 'Using a skill',
  read: 'Reading a file',
  web_search: 'Searching the web',
  web_fetch: 'Reading a page',
  memory_search: 'Checking memory',
};

function toolStep(name: string): string | undefined {
  return TOOL_STEPS[name.toLowerCase()];
}

/** Tools that hand the turn to another agent. Their result carries the child run id. */
const HANDOFF_TOOLS: Record<string, true> = { sessions_send: true, sessions_spawn: true };

/** `obj[key]` for an unknown JSON value; undefined when `obj` is not an object. */
function field(obj: unknown, key: string): unknown {
  return obj !== null && typeof obj === 'object' ? Reflect.get(obj, key) : undefined;
}

/** "my-finance" -> "My Finance". */
function agentName(id: unknown): string {
  if (typeof id !== 'string' || !id) return 'another agent';
  return id
    .split(/[-_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** "finances__budget_status" -> "Finances Budget Status". */
function humanizeTool(name: string): string {
  return name
    .split(/__|[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The step labels of the tool calls in a stored assistant row (block types differ by provider). */
function historySteps(row: unknown): string[] {
  const content = field(row, 'content');
  if (!Array.isArray(content)) return [];
  const labels: string[] = [];
  for (const block of content) {
    const type = field(block, 'type');
    if (type !== 'toolCall' && type !== 'tool_use' && type !== 'toolUse') continue;
    const name = field(block, 'name');
    if (typeof name !== 'string' || !name || name === 'tool_call') continue;
    const label = HANDOFF_TOOLS[name]
      ? `Asking ${agentName(field(field(block, 'arguments') ?? field(block, 'input'), 'agentId'))}`
      : (toolStep(name) ?? humanizeTool(name));
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}

/** The gateway's "↪️ Model Fallback: ..." notice. It arrives as a chat final but is not the answer. */
function isStatusNotice(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content)) return false;
  return message.content.some(
    (part: unknown) => !!part && typeof part === 'object' && 'openclawStatusNotice' in part && part.openclawStatusNotice === true,
  );
}

function sameKey(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

const SEND_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 200;

// ---- the agent --------------------------------------------------------------------------------

export class OpenClawAgent extends AbstractAgent {
  private readonly gateway: GatewayLike;
  private readonly hooks: OpenClawAgentHooks;
  private readonly host: RunHost;
  /** Set while a thread switch tears a run down: the gateway run must keep going, not be aborted. */
  private detaching = false;
  /** The run that sent the latest user message and is still being followed (target of steer()). */
  private sendingRun: RunStream | null = null;
  private readonly outgoing = new Map<string, OutgoingAttachment[]>();
  private readonly processes = new Map<string, AnswerProcess>();

  /** `orb`: receives run events for the global orb; only the chat's agent passes it (canvas runs do not). */
  constructor(
    gateway: GatewayLike,
    hooks: Partial<OpenClawAgentHooks> = {},
    options: { now?: () => number; orb?: (event: OrbEvent) => void } = {},
  ) {
    super({ agentId: 'ano', description: 'Ano, via the OpenClaw gateway' });
    this.gateway = gateway;
    this.hooks = { ...defaultHooks, ...hooks };
    const now = options.now ?? Date.now;
    this.host = {
      now,
      orb: options.orb ?? (() => undefined),
      takeAttachments: (messageId) => {
        const found = this.outgoing.get(messageId);
        this.outgoing.delete(messageId);
        return found;
      },
      setProcess: (messageId, process) => {
        this.processes.set(messageId, process);
        while (this.processes.size > MAX_PROCESS) {
          const oldest = this.processes.keys().next();
          if (oldest.done) break;
          this.processes.delete(oldest.value);
        }
      },
    };
  }

  /** Capabilities advertised to CopilotKit. */
  getCapabilities() {
    return Promise.resolve({ identity: { name: 'Ano' } });
  }

  /**
   * AbstractAgent.abortRun() is a no-op for non-HTTP agents. Stop = unsubscribe from the run
   * stream; the stream teardown (RunStream.dispose) then sends chat.abort to the gateway.
   */
  abortRun(): void {
    void this.detachActiveRun();
  }

  /** The OpenClaw session key of the active thread (the AG-UI threadId). */
  get sessionKey(): string {
    return this.threadId;
  }

  /** Attachments for the user message `messageId`, sent with the next `chat.send` of that message. */
  setOutgoingAttachments(messageId: string, attachments: OutgoingAttachment[]): void {
    this.outgoing.set(messageId, attachments);
  }

  /** How an answer came about (live run, or history rows), or null when there was no thinking and no step. */
  processFor(messageId: string): AnswerProcess | null {
    return this.processes.get(messageId) ?? null;
  }

  /**
   * Point the agent at another thread. An in-flight run is detached (its stream stops being
   * followed) but NOT aborted on the gateway. Call openThread() afterwards to load history.
   */
  selectThread(sessionKey: string): void {
    if (this.isRunning) {
      this.detaching = true;
      void this.detachActiveRun();
      this.detaching = false;
    }
    this.threadId = sessionKey;
    this.setMessages([]);
  }

  /** selectThread + load history (and adopt an in-flight run) through connect(). */
  async openThread(sessionKey: string): Promise<void> {
    this.selectThread(sessionKey);
    await this.connectAgent();
  }

  /**
   * Send a user message into the run that is still streaming (`chat.send` with queueMode "steer").
   * The message is added to the visible list; the active run keeps being followed, so the
   * assistant's answer continues in the same stream. Rejects when no run of this agent is active.
   */
  async steer(message: { id: string; text: string }): Promise<void> {
    const run = this.sendingRun;
    if (!run || !this.isRunning) throw new Error('No active run to steer');
    this.addMessage({ id: message.id, role: 'user', content: message.text });
    await run.steer(message);
  }

  // ---- AG-UI: run -----------------------------------------------------------------------------

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run = new RunStream(this.gateway, this.hooks, subscriber, input.threadId, input.messages, () => this.detaching, this.host);
      const last = input.messages[input.messages.length - 1];
      if (last && last.role === 'user') {
        this.sendingRun = run;
        void run.startSend(this.lastUserMessage(input.messages), input.messages);
      } else {
        // CopilotKit follow-up run after a frontend tool ran (the last message is a tool result).
        // Nothing to send to the gateway: tool results reach Ano only through [ui-event] messages
        // (build 2), so finish immediately instead of re-sending the previous user text.
        run.noop();
      }
      return () => {
        if (this.sendingRun === run) this.sendingRun = null;
        run.dispose();
      };
    });
  }

  // ---- AG-UI: connect (history snapshot, adopt in-flight run) -----------------------------------

  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run = new RunStream(this.gateway, this.hooks, subscriber, input.threadId, [], () => this.detaching, this.host);
      void run.startConnect();
      return () => run.dispose();
    });
  }

  private lastUserMessage(messages: Message[]): { id: string; text: string } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user') {
        const content = (m as { content?: unknown }).content;
        const text = typeof content === 'string' ? content : extractText({ content }) ?? '';
        return { id: m.id, text };
      }
    }
    return null;
  }
}

// ---- one run (or one connect) -----------------------------------------------------------------

class RunStream {
  private runId: string | null = null;
  private messageId = uuid();
  private transformer: AssistantStreamTransformer | null = null;
  private text = '';
  private lastMessage: unknown = undefined;
  private started = false;
  private done = false;
  private pending: ChatPayload[] = [];
  private offEvent: (() => void) | null = null;
  private offStatus: (() => void) | null = null;
  private lastReadyCount: number;
  private baseMessages: Message[];

  private readonly gateway: GatewayLike;
  private readonly hooks: OpenClawAgentHooks;
  private readonly out: Subscriber<BaseEvent>;
  private readonly sessionKey: string;
  private readonly isDetaching: () => boolean;
  private emittedText = '';
  private activity: RunActivity = IDLE_ACTIVITY;
  /** Runs of agents this run handed work to (run id -> display name). Their tool steps show too. */
  private readonly childRuns = new Map<string, string>();
  private readonly host: RunHost;
  /** The model's thinking so far (live `thinking` events), and when it started and stopped. */
  private thinking = '';
  private thinkStart: number | null = null;
  private thinkEnd: number | null = null;
  /** The distinct steps (tools, handoffs) this run went through, in order. */
  private readonly steps: string[] = [];
  /** When the orb was told this run started; null when the orb is not following it (connect, noop). */
  private orbStart: number | null = null;

  constructor(
    gateway: GatewayLike,
    hooks: OpenClawAgentHooks,
    out: Subscriber<BaseEvent>,
    sessionKey: string,
    baseMessages: Message[],
    isDetaching: () => boolean,
    host: RunHost,
  ) {
    this.gateway = gateway;
    this.hooks = hooks;
    this.out = out;
    this.sessionKey = sessionKey;
    this.baseMessages = baseMessages;
    this.isDetaching = isDetaching;
    this.host = host;
    this.lastReadyCount = gateway.getInfo().readyCount;
  }

  // -- entry points

  /** run(): send the user message, then follow the stream. */
  async startSend(user: { id: string; text: string } | null, all: Message[]): Promise<void> {
    if (!user || !user.text.trim()) {
      this.fail('Nothing to send');
      return;
    }
    this.listen();
    this.orbStart = this.host.now();
    this.host.orb({ type: 'run', mode: 'waiting' });
    const firstMessage = all.filter((m) => m.role === 'user').length <= 1;
    const message = this.hooks.decorateOutgoing(user.text, { sessionKey: this.sessionKey, firstMessage });
    const attachments = this.host.takeAttachments(user.id);
    const params: Record<string, unknown> = { sessionKey: this.sessionKey, message, idempotencyKey: user.id };
    if (attachments && attachments.length > 0) params.attachments = attachments;
    try {
      const ack = await this.gateway.request<{ runId?: string; status?: string }>('chat.send', params, SEND_TIMEOUT_MS);
      if (this.done) return;
      if (!ack?.runId) {
        this.fail('The gateway did not start a run');
        return;
      }
      this.beginRun(ack.runId);
    } catch (e) {
      this.fail(errorText(e, 'Could not send the message'));
    }
  }

  /** steer(): a user message for the run that is already streaming. */
  async steer(user: { id: string; text: string }): Promise<void> {
    if (this.done) throw new Error('The run already finished');
    const message = this.hooks.decorateOutgoing(user.text, { sessionKey: this.sessionKey, firstMessage: false });
    const attachments = this.host.takeAttachments(user.id);
    const params: Record<string, unknown> = { sessionKey: this.sessionKey, message, idempotencyKey: user.id, queueMode: 'steer' };
    if (attachments && attachments.length > 0) params.attachments = attachments;
    await this.gateway.request('chat.send', params, SEND_TIMEOUT_MS);
  }

  /** A run with nothing to send. */
  noop(): void {
    this.emit({ type: EventType.RUN_STARTED, threadId: this.sessionKey, runId: uuid() } as BaseEvent);
    this.started = true;
    this.finishRun();
  }

  /** connect(): load history as MESSAGES_SNAPSHOT and adopt a run that is still streaming. */
  async startConnect(): Promise<void> {
    this.listen();
    try {
      const history = await this.gateway.request<HistoryResult>(
        'chat.history',
        { sessionKey: this.sessionKey, limit: HISTORY_LIMIT },
        SEND_TIMEOUT_MS,
      );
      if (this.done) return;
      const inFlight = history?.inFlightRun;
      const runId = inFlight?.runId ?? uuid();
      this.emit({ type: EventType.RUN_STARTED, threadId: this.sessionKey, runId } as BaseEvent);
      this.started = true;
      this.runId = runId;
      this.emit({ type: EventType.MESSAGES_SNAPSHOT, messages: this.mapHistory(history?.messages ?? []) } as BaseEvent);
      if (inFlight?.runId) {
        this.orbStart = this.host.now();
        this.host.orb({ type: 'run', mode: this.activity.mode });
        this.publishActivity();
        this.text = inFlight.text ?? '';
        this.flushText();
        this.drainPending();
        // The run finishes through a chat final/error event handled in onChat().
      } else {
        this.finishRun();
      }
    } catch (e) {
      this.fail(errorText(e, 'Could not load this thread'));
    }
  }

  dispose(): void {
    const wasDone = this.done;
    this.done = true;
    this.offEvent?.();
    this.offStatus?.();
    this.offEvent = this.offStatus = null;
    // Stopped or detached before the end: the orb lets go of the run without a done or error.
    if (!wasDone && this.orbStart !== null) this.host.orb({ type: 'run', mode: null });
    // Unsubscribed before the run ended = the user pressed stop (not a thread switch).
    if (!wasDone && this.runId && !this.isDetaching() && this.gateway.getInfo().status === 'ready') {
      this.gateway.request('chat.abort', { sessionKey: this.sessionKey, runId: this.runId }).catch(() => undefined);
    }
  }

  // -- stream handling

  private listen(): void {
    this.offEvent = this.gateway.onEvent((event) => {
      if (event.event === 'agent') {
        this.onAgent(event.payload as AgentPayload | undefined);
        return;
      }
      if (event.event !== 'chat') return;
      const p = event.payload as ChatPayload | undefined;
      if (!p || !sameKey(p.sessionKey, this.sessionKey)) return;
      if (this.runId === null) {
        // Ack not back yet: keep the frames, they belong to our run most likely.
        this.pending.push(p);
        return;
      }
      if (p.runId && p.runId !== this.runId) return;
      this.onChat(p);
    });
    this.offStatus = this.gateway.subscribeStatus(() => {
      const info = this.gateway.getInfo();
      if (info.status === 'ready' && info.readyCount !== this.lastReadyCount) {
        this.lastReadyCount = info.readyCount;
        void this.recover();
      }
    });
  }

  private beginRun(runId: string): void {
    this.runId = runId;
    this.emit({ type: EventType.RUN_STARTED, threadId: this.sessionKey, runId } as BaseEvent);
    this.started = true;
    this.publishActivity();
    this.drainPending();
  }

  private drainPending(): void {
    const queued = this.pending;
    this.pending = [];
    for (const p of queued) {
      if (this.done) return;
      if (p.runId && p.runId !== this.runId) continue;
      this.onChat(p);
    }
  }

  private onChat(p: ChatPayload): void {
    if (this.done) return;
    switch (p.state) {
      case 'status':
        return;
      case 'delta': {
        const merged = mergeChatStreamMessage(this.lastMessage as never, p as never) as unknown;
        if (merged !== undefined) {
          this.lastMessage = merged;
          this.text = extractText(merged) ?? this.text;
        } else if (typeof p.deltaText === 'string') {
          // No baseline for an append (missed the first frame). Best effort, history fixes it up.
          this.text = p.replace ? p.deltaText : this.text + p.deltaText;
        }
        this.flushText();
        this.host.orb({ type: 'token' });
        if (this.text) this.endThinking();
        this.setActivity({ mode: 'answering', step: null });
        return;
      }
      case 'final': {
        // On a model fallback the gateway also sends a notice as a final for the same run. Not the answer.
        if (isStatusNotice(p.message)) return;
        const finalText = extractText(p.message);
        if (finalText !== undefined) this.text = finalText;
        // History-style thinking blocks on the final frame, for runs that sent no live thinking events.
        const finalThinking = extractThinking(p.message);
        if (finalThinking && !this.thinking) {
          this.thinking = finalThinking;
          this.publishProcess();
        }
        this.finishRun();
        return;
      }
      case 'aborted':
        // Stopped elsewhere: no done ring for a run that did not finish.
        if (this.orbStart !== null) this.host.orb({ type: 'run', mode: null });
        this.orbStart = null;
        this.finishRun();
        return;
      case 'error':
        this.fail(p.errorMessage || 'The run failed');
        return;
    }
  }

  /** Thinking, tool and handoff progress for the orb. */
  private onAgent(p: AgentPayload | undefined): void {
    if (this.done || this.runId === null || !p?.runId || !p.data) return;
    const data = p.data;
    const child = this.childRuns.get(p.runId);
    if (child !== undefined) {
      if (p.stream === 'item' && data.kind === 'tool' && data.phase === 'start' && typeof data.title === 'string') {
        this.host.orb({ type: 'toolStart' });
        this.setActivity({ mode: 'working', step: `${child}: ${data.title}` });
      } else if (p.stream === 'item' && data.kind === 'tool' && data.phase === 'end') {
        this.host.orb({ type: 'toolEnd' });
      }
      return;
    }
    if (p.runId !== this.runId || !sameKey(p.sessionKey, this.sessionKey)) return;
    switch (p.stream) {
      case 'thinking':
        this.onThinking(data);
        this.setActivity({ mode: 'thinking', step: null });
        return;
      case 'lifecycle': {
        const model = data.phase === 'fallback_step' ? data.fallbackStepToModel : data.phase === 'model' ? data.model : undefined;
        if (typeof model === 'string' && model) this.setActivity({ model: model.slice(model.lastIndexOf('/') + 1) });
        return;
      }
      case 'item':
        if (data.kind === 'preamble' && typeof data.progressText === 'string') {
          const note = stripPersona(data.progressText).trim();
          if (note) this.setActivity({ note });
        } else if (data.kind === 'tool' && data.phase === 'start' && typeof data.name === 'string' && data.name !== 'tool_call') {
          this.host.orb({ type: 'toolStart' });
          this.setActivity({ mode: 'working', step: toolStep(data.name) ?? (typeof data.title === 'string' ? data.title : null) });
        } else if (data.kind === 'tool' && data.phase === 'end' && data.name !== 'tool_call') {
          this.host.orb({ type: 'toolEnd' });
        }
        return;
      case 'tool': {
        if (typeof data.name !== 'string' || !HANDOFF_TOOLS[data.name]) return;
        if (data.phase === 'start') {
          const target = field(data.args, 'agentId');
          this.host.orb({ type: 'handoff', tone: typeof target === 'string' ? agentTone(target) : undefined });
          this.setActivity({ mode: 'working', step: `Asking ${agentName(target)}` });
          return;
        }
        const details = field(data.result, 'details');
        const childRunId = field(details, 'runId');
        const childKey = field(details, 'sessionKey');
        if (data.phase === 'result' && typeof childRunId === 'string' && typeof childKey === 'string') {
          this.childRuns.set(childRunId, agentName(childKey.split(':')[1]));
        }
        return;
      }
    }
  }

  /** `thinking` events carry the text so far (`text`) or an increment (`delta`). */
  private onThinking(data: Record<string, unknown>): void {
    const full = typeof data.text === 'string' ? data.text : typeof data.delta === 'string' ? this.thinking + data.delta : null;
    if (full === null) return;
    this.thinkStart ??= this.host.now();
    this.thinking = full;
    this.publishProcess();
  }

  /** The answer started (or the run ended): the thinking is over. */
  private endThinking(): void {
    if (this.thinkStart === null || this.thinkEnd !== null) return;
    this.thinkEnd = this.host.now();
    this.publishProcess();
  }

  private publishProcess(): void {
    const thinking = this.thinking.trim() || null;
    if (!thinking && this.steps.length === 0) return;
    const seconds =
      thinking && this.thinkStart !== null
        ? Math.max(1, Math.round(((this.thinkEnd ?? this.host.now()) - this.thinkStart) / 1000))
        : null;
    this.host.setProcess(this.messageId, { thinking, seconds, steps: this.steps.map((label) => ({ label })) });
  }

  private setActivity(patch: Partial<RunActivity>): void {
    if (typeof patch.step === 'string' && patch.step && this.steps[this.steps.length - 1] !== patch.step) {
      this.steps.push(patch.step);
      this.publishProcess();
    }
    const next = { ...this.activity, ...patch };
    const prev = this.activity;
    if (next.mode === prev.mode && next.note === prev.note && next.step === prev.step && next.model === prev.model) return;
    if (next.mode !== prev.mode) this.host.orb({ type: 'run', mode: next.mode });
    this.activity = next;
    this.publishActivity();
  }

  private publishActivity(): void {
    this.emit({ type: EventType.STATE_SNAPSHOT, snapshot: { activity: this.activity } } as BaseEvent);
  }

  private ensureTransformer(): AssistantStreamTransformer {
    if (!this.transformer) {
      this.transformer = this.hooks.createTransformer({
        messageId: this.messageId,
        runId: this.runId ?? 'run',
        sessionKey: this.sessionKey,
      });
    }
    return this.transformer;
  }

  /** Emit whatever the accumulated text adds. Handles non-append rewrites with a snapshot. */
  private flushText(): void {
    if (!this.text && !this.emittedText) return;
    const t = this.ensureTransformer();
    if (this.text.startsWith(this.emittedText)) {
      for (const e of t.push(this.text)) this.emit(e);
    } else {
      // The gateway replaced earlier text. AG-UI deltas can only append, so snapshot the thread.
      t.rebase(this.text);
      this.emit({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [...this.baseMessages, t.toMessage(this.text)],
      } as BaseEvent);
    }
    this.emittedText = this.text;
  }

  /** `snapshot`: replace the thread with these messages once the open message is closed. */
  private finishRun(snapshot?: Message[]): void {
    if (this.done) return;
    this.endThinking();
    if (this.text || this.transformer) {
      const t = this.ensureTransformer();
      if (!this.text.startsWith(this.emittedText)) this.flushText();
      for (const e of t.finish(this.text)) this.emit(e);
    }
    if (snapshot) this.emit({ type: EventType.MESSAGES_SNAPSHOT, messages: snapshot } as BaseEvent);
    this.done = true;
    if (this.orbStart !== null) this.host.orb({ type: 'done', ms: this.host.now() - this.orbStart });
    this.orbStart = null;
    this.cleanup();
    if (!this.started) this.emit({ type: EventType.RUN_STARTED, threadId: this.sessionKey, runId: this.runId ?? uuid() } as BaseEvent);
    this.emit({ type: EventType.RUN_FINISHED, threadId: this.sessionKey, runId: this.runId ?? uuid() } as BaseEvent);
    this.out.complete();
  }

  private fail(message: string): void {
    if (this.done) return;
    this.done = true;
    if (this.orbStart !== null) this.host.orb({ type: 'error' });
    this.orbStart = null;
    this.cleanup();
    // Close an open assistant message so verification does not choke on the error.
    if (this.transformer && this.started) {
      for (const e of this.transformer.finish(this.text)) this.emit(e);
    }
    this.emit({ type: EventType.RUN_ERROR, message } as BaseEvent);
    this.out.complete();
  }

  private cleanup(): void {
    this.offEvent?.();
    this.offStatus?.();
    this.offEvent = this.offStatus = null;
  }

  private emit(event: BaseEvent): void {
    if (!this.out.closed) this.out.next(event);
  }

  /** After a reconnect: adopt the in-flight text or, if the run ended meanwhile, show the stored thread. */
  private async recover(): Promise<void> {
    if (this.done || !this.runId) return;
    try {
      const history = await this.gateway.request<HistoryResult>(
        'chat.history',
        { sessionKey: this.sessionKey, limit: HISTORY_LIMIT },
        SEND_TIMEOUT_MS,
      );
      if (this.done) return;
      const inFlight = history?.inFlightRun;
      if (inFlight?.runId === this.runId) {
        if (typeof inFlight.text === 'string' && inFlight.text.length >= this.text.length) {
          this.text = inFlight.text;
          this.lastMessage = undefined;
          this.flushText();
        }
        return;
      }
      // Not running anymore. A handoff leaves several assistant rows, so show the thread as stored.
      this.finishRun(this.mapHistory(history?.messages ?? []));
    } catch {
      // The next reconnect or the final event will sort it out.
    }
  }

  // -- history mapping

  private mapHistory(rows: NonNullable<HistoryResult['messages']>): Message[] {
    const out: Message[] = [];
    // Tool-calling rows carry no text: their thinking and steps belong to the answer that follows.
    let carriedThinking = '';
    let carriedSteps: string[] = [];
    rows.forEach((row, i) => {
      if (row.role === 'user') {
        carriedThinking = '';
        carriedSteps = [];
        // The idempotencyKey is the id the app sent the message with (local image thumbnails are keyed by it).
        const id = row.idempotencyKey ?? row.__openclaw?.id ?? `h-${i}`;
        const raw = typeof row.content === 'string' ? row.content : extractText(row) ?? '';
        const cleaned = this.hooks.cleanIncoming(raw);
        if (!cleaned.hidden && cleaned.text.trim()) out.push({ id, role: 'user', content: cleaned.text } as Message);
      } else if (row.role === 'assistant' && !isStatusNotice(row)) {
        const id = row.__openclaw?.id ?? row.idempotencyKey ?? `h-${i}`;
        const thinking = extractThinking(row);
        const steps = historySteps(row);
        if (thinking) carriedThinking = carriedThinking ? `${carriedThinking}\n\n${thinking}` : thinking;
        const text = extractText(row);
        if (text && text.trim()) {
          const t = this.hooks.createTransformer({ messageId: id, runId: id, sessionKey: this.sessionKey });
          out.push(t.toMessage(text));
          if (carriedThinking || carriedSteps.length > 0) {
            this.host.setProcess(id, {
              thinking: carriedThinking || null,
              seconds: null,
              steps: carriedSteps.map((label) => ({ label })),
            });
          }
          carriedThinking = '';
          // Tools this row called ran after its text: they belong to the next answer.
          carriedSteps = steps;
        } else {
          for (const label of steps) if (carriedSteps[carriedSteps.length - 1] !== label) carriedSteps.push(label);
        }
      }
    });
    return out;
  }
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
