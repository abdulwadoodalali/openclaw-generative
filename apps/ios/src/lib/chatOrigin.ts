// Where a pinned or Ano-made canvas came from: the question the user asked just before the answer
// that drew it. Used for `Canvas.origin.prompt`, which a refresh re-asks. Pure TypeScript.

type MessageLike = {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: ReadonlyArray<{ id: string }>;
};

const UI_EVENT_PREFIX = '[ui-event]';

function userPromptBefore(messages: readonly MessageLike[], index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const text = m.content.trim();
    // A tap on a component is plumbing, not the question.
    if (text && !text.startsWith(UI_EVENT_PREFIX)) return text;
  }
  return '';
}

/** The user message before the message with `messageId` ('' when there is none). */
export function promptBeforeMessage(messages: readonly MessageLike[], messageId: string): string {
  const index = messages.findIndex((m) => m.id === messageId);
  return index < 0 ? '' : userPromptBefore(messages, index);
}

/** The user message before the assistant message that made tool call `toolCallId` ('' when there is none). */
export function promptBeforeToolCall(messages: readonly MessageLike[], toolCallId: string): string {
  const index = messages.findIndex((m) => m.toolCalls?.some((c) => c.id === toolCallId));
  return index < 0 ? '' : userPromptBefore(messages, index);
}
