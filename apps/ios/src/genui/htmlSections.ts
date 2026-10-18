// Turns assistant markdown that contains raw HTML section tags and tool call markers into render
// blocks, in document order. Models like to write collapsible sections as
// `<details><summary>Title</summary>BODY</details>`; the app never shows those tags: a details
// block becomes a native collapsible whose body is parsed the same way (so cards, marked by
// proseMarkers, render inside it), and every other raw HTML tag is reduced to its text.
// Pure TypeScript.
import { splitMarkers } from './proseMarkers.ts';

export type Block =
  | { type: 'markdown'; text: string }
  | { type: 'call'; index: number }
  | { type: 'details'; summary: string; open: boolean; blocks: Block[] };

const MAX_DEPTH = 4;
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/;
const TAG_RE = /<\/?details\b[^>]*>/gi;
const SUMMARY_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i;

/** Character ranges `[start, end)` of fenced code blocks, so tags inside code are left alone. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: { fence: string; start: number } | null = null;
  let pos = 0;
  for (const line of text.split('\n')) {
    const end = pos + line.length + 1;
    const match = FENCE_LINE_RE.exec(line);
    if (match) {
      if (!open) open = { fence: match[1], start: pos };
      else if (match[1][0] === open.fence[0] && match[1].length >= open.fence.length) {
        ranges.push([open.start, end]);
        open = null;
      }
    }
    pos = end;
  }
  if (open) ranges.push([open.start, text.length + 1]);
  return ranges;
}

function inRanges(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** Raw HTML tags and comments to plain text, leaving code (fenced and inline) and markers alone. */
export function stripHtml(text: string): string {
  const ranges = codeRanges(text);
  let out = '';
  let pos = 0;
  const re = /<!--(?!ano:tc\d)[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    if (inRanges(match.index, ranges) || insideInlineCode(text, match.index)) continue;
    out += text.slice(pos, match.index);
    pos = match.index + match[0].length;
    const tag = match[0].toLowerCase();
    if (/^<br\b/.test(tag)) out += '\n';
    else if (/^<li\b/.test(tag)) out += '\n- ';
    else if (/^<\/(p|div|h[1-6]|ul|ol|table|tr|blockquote)\b/.test(tag)) out += '\n\n';
  }
  return out + text.slice(pos);
}

/** True when `index` sits between an odd number of backticks on its own line. */
function insideInlineCode(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  let ticks = 0;
  for (let i = lineStart; i < index; i++) if (text[i] === '`') ticks += 1;
  return ticks % 2 === 1;
}

/** A tag still streaming in at the very end (`<det`, `</summ`) is not shown as text for a frame. */
function dropPartialTag(text: string): string {
  const start = text.lastIndexOf('<');
  if (start < 0 || !/^<\/?[A-Za-z!][^<>\n]*$/.test(text.slice(start))) return text;
  return inRanges(start, codeRanges(text)) || insideInlineCode(text, start) ? text : text.slice(0, start);
}

function textBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const piece of splitMarkers(text)) {
    if (piece.type === 'call') {
      blocks.push(piece);
      continue;
    }
    const cleaned = stripHtml(piece.text).replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned) blocks.push({ type: 'markdown', text: cleaned });
  }
  return blocks;
}

/**
 * Parses assistant text into blocks. A details block without its closing tag runs to the end of the
 * text (it is still streaming, or the model forgot `</details>`), so raw tags never show.
 */
export function parseBlocks(raw: string, depth = 0): Block[] {
  const text = depth === 0 ? dropPartialTag(raw) : raw;
  const ranges = codeRanges(text);
  const blocks: Block[] = [];
  let last = 0;
  let cursor = 0;
  for (;;) {
    // Find the next opening tag outside code.
    TAG_RE.lastIndex = cursor;
    let open: RegExpExecArray | null = null;
    for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
      if (!m[0].startsWith('</') && !inRanges(m.index, ranges)) {
        open = m;
        break;
      }
    }
    if (!open || depth >= MAX_DEPTH) break;
    // Find its matching close, counting nested details.
    const bodyStart = open.index + open[0].length;
    let level = 1;
    let bodyEnd = text.length;
    let after = text.length;
    TAG_RE.lastIndex = bodyStart;
    for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
      if (inRanges(m.index, ranges)) continue;
      level += m[0].startsWith('</') ? -1 : 1;
      if (level === 0) {
        bodyEnd = m.index;
        after = m.index + m[0].length;
        break;
      }
    }
    blocks.push(...textBlocks(text.slice(last, open.index)));
    const body = text.slice(bodyStart, bodyEnd);
    const summary = SUMMARY_RE.exec(body);
    const title = summary ? stripHtml(summary[1]).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim() : '';
    const inner = summary ? body.slice(0, summary.index) + body.slice(summary.index + summary[0].length) : body;
    const innerBlocks = parseBlocks(inner, depth + 1);
    // `<details>` that has streamed in with nothing after it yet shows nothing, not an empty header.
    if (title || innerBlocks.length > 0) {
      blocks.push({ type: 'details', summary: title || 'Details', open: /\sopen\b/i.test(open[0]), blocks: innerBlocks });
    }
    last = after;
    cursor = after;
  }
  blocks.push(...textBlocks(text.slice(last)));
  return blocks;
}
