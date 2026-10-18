// Pure text helpers for gateway messages. No React or Expo imports so they can run anywhere.

type Block = { type?: string; text?: string };

/** Join the text blocks of a gateway message. Returns undefined when there is no text field at all. */
export function extractText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content as Block[]) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/** Join the `thinking` blocks of a gateway message (history rows and final frames carry them). '' when there are none. */
export function extractThinking(message: unknown): string {
  if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content)) return '';
  const parts: string[] = [];
  for (const block of message.content) {
    if (!block || typeof block !== 'object' || !('type' in block) || block.type !== 'thinking') continue;
    if ('thinking' in block && typeof block.thinking === 'string' && block.thinking.trim()) parts.push(block.thinking.trim());
  }
  return parts.join('\n\n');
}

const PERSONA_PREFIX = '**Ano**';
/** Fallback models write the marker without bold: "Ano: Sure" or "Ano Sure". */
const PLAIN_PERSONA = /^Ano(?::|\s)[\s:,.·-]*/;
/** A reply written in several steps repeats the bold marker at the start of later paragraphs. */
const INNER_PERSONA = /\n\n\*\*Ano\*\*[ \t:,.·-]*/g;

/**
 * The Ano General agent starts replies with a bolded "Ano" (a vault rule). The app already shows
 * Ano in the header, so drop it, bold or plain. Safe on partial streaming text: a text that is
 * still a prefix of the bold marker renders as empty instead of flashing stray asterisks.
 */
export function stripPersona(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.length < PERSONA_PREFIX.length && PERSONA_PREFIX.startsWith(trimmed)) return '';
  let rest: string;
  if (trimmed.startsWith(PERSONA_PREFIX)) {
    rest = trimmed.slice(PERSONA_PREFIX.length).replace(/^[\s:,.·-]+/, '');
  } else {
    const plain = PLAIN_PERSONA.exec(trimmed);
    rest = plain ? trimmed.slice(plain[0].length) : text;
  }
  return rest.replace(INNER_PERSONA, '\n\n');
}
