// AssistantStreamTransformer that turns `ano-ui` / `ano-define` fences in the assistant text into
// AG-UI tool calls (render_<Name> / define_component), and everything else into one text message.
// Pure TypeScript apart from the @ag-ui/client event enum.
//
// Prose and cards keep their order: every tool call leaves a marker paragraph (`<!--ano:tc0-->`,
// see proseMarkers.ts) in the prose at the position of its fence, and MessageBubble draws the card
// where the marker is.
//
// Design: the whole message (prose + tool calls) is a pure function of the full text
// (`planMessage`). The transformer only diffs that plan against what it already emitted, so for
// any chunking of a text, the streamed events add up to exactly `toMessage(text)`.
//
// Event order (checked against @ag-ui/client 1.0.2 verify + default apply): the assistant text
// message stays open for the whole run (TEXT_MESSAGE_START is emitted before the first tool
// event, even without prose) and the tool calls hang on it through `parentMessageId`; the
// reducer builds ONE assistant message with `content` + `toolCalls`. TOOL_CALL_START is accepted
// while a text message is open.
import { EventType } from '@ag-ui/client';
import type {
  AssistantMessage,
  BaseEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from '@ag-ui/client';
import type { AssistantStreamTransformer, TransformerContext } from '../openclaw/OpenClawAgent.ts';
import { MAX_FENCE_BYTES, decodeFence, detectComponentName, fenceInfo, parseSegments, type FenceSegment, type FenceValidator } from './fences.ts';
import { toolCallMarker } from './proseMarkers.ts';
import { CANVAS_TOOL_NAME, DEFINE_TOOL_NAME, RENDER_TOOL_PREFIX, type FallbackArgs } from './types.ts';

export type FenceTransformerOptions = {
  /** Validates props of a ui fence against the registry. null = component unknown, pass through. */
  validate?: FenceValidator;
};

type PlannedCall = {
  id: string;
  name: string;
  /** Serialized args. undefined while the fence is still streaming (skeleton). */
  args: string | undefined;
};

type Plan = { prose: string; calls: PlannedCall[] };

/** What was emitted so far for one planned call. */
type CallProgress = { started: boolean; args: boolean; ended: boolean };

/** The fence as markdown, for a fence that failed before it could be announced as a tool call. */
function fenceAsText(seg: FenceSegment): string {
  return `\`\`\`${fenceInfo(seg.kind)}\n${seg.json}${seg.complete ? '\n```' : ''}`.trimEnd();
}

function planMessage(messageId: string, raw: string, final: boolean, validate: FenceValidator | undefined): Plan {
  const pieces: string[] = [];
  const calls: PlannedCall[] = [];
  for (const seg of parseSegments(raw, { final, keepFailed: true })) {
    if (seg.kind === 'text') {
      pieces.push(seg.text);
      continue;
    }
    const id = `${messageId}:tc${calls.length}`;
    const addCall = (call: PlannedCall) => {
      pieces.push(toolCallMarker(calls.length));
      calls.push(call);
    };
    let announced: string | null;
    if (seg.kind === 'define') announced = DEFINE_TOOL_NAME;
    else if (seg.kind === 'canvas') announced = CANVAS_TOOL_NAME;
    else {
      const component = detectComponentName(seg.json);
      announced = component ? `${RENDER_TOOL_PREFIX}${component}` : null;
    }
    if (!seg.complete && !final) {
      if (announced) addCall({ id, name: announced, args: undefined });
      continue;
    }
    const decoded = decodeFence(seg, validate);
    if (decoded.ok && (announced === null || announced === decoded.call.name)) {
      addCall({ id, name: decoded.call.name, args: JSON.stringify(decoded.call.args) });
    } else if (announced) {
      const fallback: FallbackArgs = {
        __fallback: seg.json.slice(0, MAX_FENCE_BYTES),
        __error: decoded.ok ? 'component name changed after the fence started' : decoded.error,
      };
      addCall({ id, name: announced, args: JSON.stringify(fallback) });
    } else {
      pieces.push(fenceAsText(seg));
    }
  }
  return { prose: pieces.join('\n\n'), calls };
}

export function createFenceTransformer(ctx: TransformerContext, opts: FenceTransformerOptions = {}): AssistantStreamTransformer {
  const messageId = ctx.messageId;
  const emitted: CallProgress[] = [];
  let proseEmitted = '';
  let textOpen = false;
  let finished = false;
  let rebasedText: string | null = null;
  const staleOpen: number[] = [];

  const openText = (events: BaseEvent[]) => {
    if (textOpen) return;
    const start: TextMessageStartEvent = { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' };
    events.push(start);
    textOpen = true;
  };

  const endCall = (events: BaseEvent[], index: number) => {
    const end: ToolCallEndEvent = { type: EventType.TOOL_CALL_END, toolCallId: `${messageId}:tc${index}` };
    events.push(end);
  };

  /** Emit whatever `plan` adds to what was already emitted. */
  const sync = (plan: Plan): BaseEvent[] => {
    const events: BaseEvent[] = [];
    for (const index of staleOpen.splice(0)) endCall(events, index);
    // Prose only ever grows (prefix stability of parseSegments); anything else is ignored here.
    if (plan.prose.length > proseEmitted.length && plan.prose.startsWith(proseEmitted)) {
      openText(events);
      const content: TextMessageContentEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: plan.prose.slice(proseEmitted.length),
      };
      events.push(content);
      proseEmitted = plan.prose;
    }
    plan.calls.forEach((call, index) => {
      const progress = (emitted[index] ??= { started: false, args: false, ended: false });
      if (!progress.started && !progress.ended) {
        openText(events);
        const start: ToolCallStartEvent = {
          type: EventType.TOOL_CALL_START,
          toolCallId: call.id,
          toolCallName: call.name,
          parentMessageId: messageId,
        };
        events.push(start);
        progress.started = true;
      }
      if (call.args === undefined) return;
      if (!progress.args) {
        const args: ToolCallArgsEvent = { type: EventType.TOOL_CALL_ARGS, toolCallId: call.id, delta: call.args };
        events.push(args);
        progress.args = true;
      }
      if (!progress.ended) {
        endCall(events, index);
        progress.ended = true;
      }
    });
    return events;
  };

  const plan = (fullText: string, final: boolean) => planMessage(messageId, fullText, final, opts.validate);

  return {
    push(fullText) {
      if (finished) return [];
      return sync(plan(fullText, false));
    },

    rebase(fullText) {
      const current = plan(fullText, false);
      proseEmitted = current.prose;
      rebasedText = fullText;
      // The snapshot the agent emits next holds this plan. Calls the event stream never opened
      // (or already closed) need no events for it; a call still open in the stream gets its END.
      current.calls.forEach((call, index) => {
        const progress = (emitted[index] ??= { started: false, args: false, ended: false });
        const open = progress.started && !progress.ended;
        progress.args = call.args !== undefined;
        if (open) return;
        progress.started = progress.args;
        progress.ended = progress.args;
      });
      // Calls the rewrite dropped but the event stream still holds open get their END on the
      // next sync, and a later call at the same index starts afresh.
      for (let index = current.calls.length; index < emitted.length; index++) {
        if (emitted[index].started && !emitted[index].ended) staleOpen.push(index);
      }
      emitted.length = current.calls.length;
    },

    finish(fullText) {
      if (finished) return [];
      finished = true;
      const final = plan(fullText, true);
      const events = sync(final);
      if (textOpen) {
        const end: TextMessageEndEvent = { type: EventType.TEXT_MESSAGE_END, messageId };
        events.push(end);
      }
      return events;
    },

    toMessage(fullText) {
      // Right after rebase() the agent snapshots mid-stream: open fences stay skeletons so the
      // calls that follow can still stream into them. Everything else is the settled message.
      const streaming = !finished && rebasedText === fullText;
      const { prose, calls } = plan(fullText, !streaming);
      const message: AssistantMessage = { id: messageId, role: 'assistant', content: prose };
      if (calls.length > 0) {
        message.toolCalls = calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.args ?? '' },
        }));
      }
      return message;
    },
  };
}
