// One user turn: what the chat controller does between "send" and the agent run, kept pure so it is
// testable under Node. Pure (no react / react-native / expo).
import { toAttachments, type ImageStore } from './images.ts';
import { patchSessionEffort, patchSessionModel, type SessionBrain } from './sessionPrefs.ts';
import type { PickedImage } from './types.ts';
import type { OutgoingAttachment } from '../openclaw/OpenClawAgent.ts';
import type { RequestFn } from '../openclaw/sessionsApi.ts';

/** The part of OpenClawAgent a turn needs. */
export type TurnAgent = {
  addMessage(message: { id: string; role: 'user'; content: string }): void;
  setOutgoingAttachments(messageId: string, attachments: OutgoingAttachment[]): void;
};

/** The text sent when the user attached images and typed nothing (chat.send needs a message). */
export function imageOnlyPrompt(imageCount: number): string {
  return imageCount > 1 ? 'What do you see in these images?' : 'What do you see in this image?';
}

/**
 * Runs one turn on a different model and effort than the chat has, then puts the chat back: patches
 * the session to `once`, calls `run`, and restores `previous` (null resets to the agent default)
 * whether `run` finished, failed or was stopped. `run` stays the turn's own outcome: its error wins
 * over a restore error.
 */
export async function withBrain(
  req: RequestFn,
  key: string,
  once: SessionBrain,
  previous: { model: string | null; effort: string | null },
  run: () => Promise<void>,
): Promise<void> {
  await patchSessionModel(req, key, once.model);
  await patchSessionEffort(req, key, once.effort);
  let failed: { error: unknown } | null = null;
  try {
    await run();
  } catch (error) {
    failed = { error };
  }
  let restoreError: unknown = null;
  for (const restore of [() => patchSessionModel(req, key, previous.model), () => patchSessionEffort(req, key, previous.effort)]) {
    try {
      await restore();
    } catch (error) {
      restoreError ??= error;
    }
  }
  if (failed) throw failed.error;
  if (restoreError) throw restoreError;
}

/**
 * Adds the user message to the agent and hands its images over for the next `chat.send`. The caller
 * runs the agent afterwards. `text` is already trimmed and non-empty (see imageOnlyPrompt).
 */
export function startTurn(agent: TurnAgent, store: ImageStore, turn: { id: string; text: string; images: PickedImage[] }): void {
  if (turn.images.length > 0) {
    store.set(turn.id, turn.images);
    agent.setOutgoingAttachments(turn.id, toAttachments(turn.images));
  }
  agent.addMessage({ id: turn.id, role: 'user', content: turn.text });
}

/** Like startTurn, but into the run that is still streaming (agent.steer adds the message itself). */
export async function steerTurn(
  agent: Pick<TurnAgent, 'setOutgoingAttachments'> & { steer(message: { id: string; text: string }): Promise<void> },
  store: ImageStore,
  turn: { id: string; text: string; images: PickedImage[] },
): Promise<void> {
  if (turn.images.length > 0) {
    store.set(turn.id, turn.images);
    agent.setOutgoingAttachments(turn.id, toAttachments(turn.images));
  }
  await agent.steer({ id: turn.id, text: turn.text });
}

/** What retry re-sends: the text and images of the last user message, or null when there is none. */
export function planRetry(messages: ReadonlyArray<object>, store: ImageStore): { text: string; images: PickedImage[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!('role' in m) || m.role !== 'user' || !('id' in m) || typeof m.id !== 'string') continue;
    if (!('content' in m) || typeof m.content !== 'string') continue;
    const text = m.content.trim();
    if (text) return { text, images: store.get(m.id) };
  }
  return null;
}
