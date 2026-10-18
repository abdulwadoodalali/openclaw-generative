// Invisible markers that keep prose and cards in document order. The fence transformer leaves one
// marker paragraph in the assistant text at the position of every tool call (`<!--ano:tc0-->`,
// keyed by the call index); MessageBubble splits the text on them and draws the matching card in
// place. The marker is an HTML comment, so any markdown renderer that sees it unprocessed shows
// nothing. Pure TypeScript.

const MARKER_SOURCE = '<!--ano:tc(\\d{1,4})-->';

/** The marker line for the tool call at `index` of a message. */
export function toolCallMarker(index: number): string {
  return `<!--ano:tc${index}-->`;
}

export type ProsePiece = { type: 'text'; text: string } | { type: 'call'; index: number };

/** Splits assistant text on tool call markers, in order. Empty text pieces are dropped. */
export function splitMarkers(text: string): ProsePiece[] {
  const pieces: ProsePiece[] = [];
  const re = new RegExp(MARKER_SOURCE, 'g');
  let last = 0;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const before = text.slice(last, match.index);
    if (before.trim()) pieces.push({ type: 'text', text: before.trim() });
    pieces.push({ type: 'call', index: Number(match[1]) });
    last = match.index + match[0].length;
  }
  const rest = text.slice(last);
  if (rest.trim()) pieces.push({ type: 'text', text: rest.trim() });
  return pieces;
}

/** The text without any marker, for places that use the assistant text as text (labels, copy). */
export function stripMarkers(text: string): string {
  return text
    .replace(new RegExp(`\\n*${MARKER_SOURCE}\\n*`, 'g'), '\n\n')
    .replace(/^\n+|\n+$/g, '');
}
