// A gateway with no network that replays the recorded demo thread (HANDOFF step 8). It satisfies
// GatewayLike, so a real OpenClawAgent (with the real fence transformer) runs against it exactly as
// it does against the OpenClaw gateway: chat.send is acked with a runId, then a `status` event,
// `delta` events about every 40 ms and a `final` event arrive on timers. Pure TypeScript.
import type { GatewayLike } from '../../openclaw/OpenClawAgent.ts';
import { cleanUserText, parseUiEvent } from '../catalog.ts';
import { chunkReply, type DemoScript } from './demoScript.ts';

export type DemoGatewayOptions = {
  /** Delay between two streamed chunks. Default 40 ms. */
  chunkDelayMs?: number;
  /** Delay before the first chunk (the "status" phase). Default 120 ms. */
  startDelayMs?: number;
  /** How a reply is cut into deltas. Default `chunkReply`. */
  chunk?: (reply: string) => string[];
};

export type DemoGateway = GatewayLike & {
  /** Forget which turns were played, so the next messages start the script again. */
  reset(): void;
  /** Number of scripted turns played since creation or the last reset. */
  readonly played: number;
  /** Index of the first scripted turn not played yet, -1 once every turn was played. */
  readonly nextTurn: number;
};

type Frame = Parameters<Parameters<GatewayLike['onEvent']>[0]>[0];

/** A run is live while it is in `runs`; a pending timer of a removed run does nothing. */
type DemoRun = { runId: string; sessionKey: string; seq: number; text: string };

export function createDemoGateway(script: DemoScript, options: DemoGatewayOptions = {}): DemoGateway {
  const chunkDelayMs = options.chunkDelayMs ?? 40;
  const startDelayMs = options.startDelayMs ?? 120;
  const chunk = options.chunk ?? chunkReply;
  const listeners = new Set<(event: Frame) => void>();
  const runs = new Map<string, DemoRun>();
  const playedTurns = new Set<number>();
  const firstUnplayed = () => script.turns.findIndex((_, i) => !playedTurns.has(i));
  let runCounter = 0;
  let frameSeq = 0;

  const emit = (run: DemoRun, fields: Record<string, unknown>) => {
    run.seq += 1;
    frameSeq += 1;
    const frame: Frame = {
      type: 'event',
      event: 'chat',
      payload: { runId: run.runId, sessionKey: run.sessionKey, seq: run.seq, ...fields },
      seq: frameSeq,
    };
    for (const listener of [...listeners]) listener(frame);
  };

  const finalMessage = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] });

  /** The reply text for one user message: a ui-event ack, the matching or next turn, or the fallback. */
  const replyFor = (message: string): string => {
    const visible = cleanUserText(message).text.trim();
    const uiEvent = parseUiEvent(visible);
    if (uiEvent) {
      return `**Ano** Got it: \`${uiEvent.event}\` on ${uiEvent.component}. This is a recorded demo, so nothing else happens, but a real thread would answer here.`;
    }
    let index = script.turns.findIndex((turn, i) => !playedTurns.has(i) && turn.user === visible);
    if (index < 0) index = firstUnplayed();
    if (index < 0) return script.fallbackReply;
    playedTurns.add(index);
    return script.turns[index].reply;
  };

  const stream = (run: DemoRun, text: string) => {
    const chunks = chunk(text);
    let next = 0;
    const step = () => {
      if (!runs.has(run.runId)) return;
      if (next < chunks.length) {
        run.text += chunks[next];
        // The first delta also carries the full snapshot so far, like the real gateway.
        emit(run, {
          state: 'delta',
          deltaText: chunks[next],
          ...(next === 0 ? { message: finalMessage(run.text) } : {}),
        });
        next += 1;
        setTimeout(step, chunkDelayMs);
        return;
      }
      runs.delete(run.runId);
      emit(run, { state: 'final', message: finalMessage(text) });
    };
    emit(run, { state: 'status', phase: 'starting_model' });
    setTimeout(step, startDelayMs);
  };

  return {
    async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      switch (method) {
        case 'chat.history':
          return { sessionKey: params.sessionKey, messages: [], hasMore: false, totalMessages: 0 } as T;
        case 'chat.send': {
          const { sessionKey, message } = params;
          if (typeof sessionKey !== 'string' || typeof message !== 'string') throw new Error('demo gateway: chat.send needs sessionKey and message');
          runCounter += 1;
          const run: DemoRun = { runId: `demo-run-${runCounter}`, sessionKey, seq: 0, text: '' };
          runs.set(run.runId, run);
          stream(run, replyFor(message));
          return { runId: run.runId, status: 'started' } as T;
        }
        case 'chat.abort': {
          const run = typeof params.runId === 'string' ? runs.get(params.runId) : undefined;
          if (run) {
            runs.delete(run.runId);
            emit(run, { state: 'aborted' });
          }
          return { ok: true, runId: run?.runId ?? null } as T;
        }
        default:
          throw new Error(`demo gateway: ${method} is not available offline`);
      }
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeStatus: () => () => undefined,
    getInfo: () => ({ status: 'ready', readyCount: 1 }),
    reset() {
      runs.clear();
      playedTurns.clear();
    },
    get played() {
      return playedTurns.size;
    },
    get nextTurn() {
      return firstUnplayed();
    },
  };
}
