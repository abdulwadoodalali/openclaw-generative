// Images attached to user messages. The gateway does not give the image back in chat.history, so the
// app keeps what the user picked, keyed by the user message id (the chat.send idempotencyKey).
// Pure (no react / react-native / expo).
import type { OutgoingAttachment } from '../openclaw/OpenClawAgent.ts';
import type { PickedImage } from './types.ts';

/** How many messages' images are kept (base64 is large). The oldest are dropped first. */
const MAX_MESSAGES = 24;

export class ImageStore {
  private readonly byMessage = new Map<string, PickedImage[]>();

  set(messageId: string, images: PickedImage[]): void {
    this.byMessage.delete(messageId);
    this.byMessage.set(messageId, images);
    while (this.byMessage.size > MAX_MESSAGES) {
      const oldest = this.byMessage.keys().next();
      if (oldest.done) break;
      this.byMessage.delete(oldest.value);
    }
  }

  get(messageId: string): PickedImage[] {
    return this.byMessage.get(messageId) ?? [];
  }
}

/** The `chat.send` attachment shape for picked images. */
export function toAttachments(images: PickedImage[]): OutgoingAttachment[] {
  return images.map((image) => ({
    type: 'image',
    mimeType: image.mimeType,
    fileName: image.fileName,
    content: image.base64,
  }));
}
