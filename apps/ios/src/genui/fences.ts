// Streaming parser for the generative UI fenced blocks. Pure TypeScript (no react, no expo), so it
// runs under Node for tests. See notes/genui-and-threads.md sections 2, 3 and 7.2.
//
// The assistant answers in Markdown that may contain two kinds of fenced blocks:
//   ```ano-ui      {"component":"Name","props":{...}}   use a registered native component
//   ```ano-define  {"name":"Name", ...}                  define a new component (data, no code)
//   ```ano-canvas  {"op":"create","title":..,"blocks":[..]} save or update a canvas (see src/canvas)
// The app re-parses the whole (growing) text on every streamed delta, so parseSegments is cheap,
// deterministic and prefix-stable: the text segments of a prefix are prefixes of the text segments
// of any longer text.
import { z } from 'zod';
import {
  CANVAS_TOOL_NAME,
  COMPONENT_NAME_RE,
  DEFINE_TOOL_NAME,
  LIMITS,
  RENDER_TOOL_PREFIX,
  type JsonObject,
  type JsonValue,
} from './types.ts';

export const MAX_FENCE_BYTES = LIMITS.maxFenceBytes;

/** Why an ano fence cannot be used. Only produced with `keepFailed` (see parseSegments). */
export type FenceError = 'oversize' | 'unclosed';

export type TextSegment = { kind: 'text'; text: string };
export type FenceSegment =
  | { kind: 'ui'; json: string; complete: boolean; error?: FenceError }
  | { kind: 'define'; json: string; complete: boolean; error?: FenceError }
  | { kind: 'canvas'; json: string; complete: boolean; error?: FenceError };
export type Segment = TextSegment | FenceSegment;

export type ParseOptions = {
  /** The text will not grow anymore: partial openers are text, unclosed fences are finished. */
  final?: boolean;
  /**
   * Keep oversize and unclosed-at-final fences as fence segments carrying `error` instead of
   * degrading them to text. The fence transformer needs this: it already announced the tool call
   * (skeleton) while the fence was streaming and must settle it with fallback args.
   */
  keepFailed?: boolean;
};

const OPENER_RE = /^ {0,3}```(ano-ui|ano-define|ano-canvas)[ \t]*$/;
const OTHER_OPENER_RE = /^ {0,3}(`{3,})[^`]*$/;
const OTHER_CLOSER_RE = /^ {0,3}(`{3,})[ \t]*$/;
const ANO_CLOSER_RE = /^[ \t]*```[ \t]*$/;
const PARTIAL_CLOSER_RE = /^[ \t]*`{1,3}[ \t]*$/;
const OPENER_TEXTS = ['```ano-ui', '```ano-define', '```ano-canvas'];

const FENCE_KINDS: Record<string, FenceSegment['kind']> = { 'ano-ui': 'ui', 'ano-define': 'define', 'ano-canvas': 'canvas' };

/** The info string of a fence kind, as written after the opening backticks. */
export function fenceInfo(kind: FenceSegment['kind']): string {
  return `ano-${kind}`;
}

/** True when `line` (no newline yet) may still grow into an ano fence opener line. */
function isPartialOpener(line: string): boolean {
  const body = line.replace(/^ {0,3}/, '');
  const trimmed = body.replace(/[ \t]+$/, '');
  if (!trimmed) return false;
  if (trimmed !== body) return OPENER_TEXTS.includes(trimmed);
  return OPENER_TEXTS.some((opener) => opener.startsWith(trimmed));
}

const encoder = new TextEncoder();

function exceedsFenceLimit(json: string): boolean {
  if (json.length > MAX_FENCE_BYTES) return true; // bytes >= UTF-16 units
  if (json.length * 3 <= MAX_FENCE_BYTES) return false; // at most 3 bytes per unit
  return encoder.encode(json).length > MAX_FENCE_BYTES;
}

function stripCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export function parseSegments(raw: string, opts: ParseOptions = {}): Segment[] {
  const final = opts.final === true;
  const keepFailed = opts.keepFailed === true;
  const segments: Segment[] = [];
  let text = '';
  let otherFence = 0; // backtick count of the open non-ano code block, 0 = none
  let pos = 0;

  const flushText = () => {
    const trimmed = text.trim();
    if (trimmed) segments.push({ kind: 'text', text: trimmed });
    text = '';
  };

  while (pos < raw.length) {
    const nl = raw.indexOf('\n', pos);
    const terminated = nl !== -1;
    const next = terminated ? nl + 1 : raw.length;
    const line = stripCR(raw.slice(pos, terminated ? nl : raw.length));

    if (otherFence > 0) {
      const closer = OTHER_CLOSER_RE.exec(line);
      if (closer && closer[1].length >= otherFence) otherFence = 0;
      text += raw.slice(pos, next);
      pos = next;
      continue;
    }

    const opener = terminated ? OPENER_RE.exec(line) : null;
    if (opener) {
      const kind = FENCE_KINDS[opener[1]];
      let closed = false;
      let bodyEnd = raw.length;
      let after = raw.length;
      let p = next;
      while (p < raw.length) {
        const e = raw.indexOf('\n', p);
        const lineTerminated = e !== -1;
        const bodyLine = stripCR(raw.slice(p, lineTerminated ? e : raw.length));
        if (ANO_CLOSER_RE.test(bodyLine) && (lineTerminated || final)) {
          closed = true;
          bodyEnd = p;
          after = lineTerminated ? e + 1 : raw.length;
          break;
        }
        if (!lineTerminated && !final && PARTIAL_CLOSER_RE.test(bodyLine)) bodyEnd = p; // may still grow
        p = lineTerminated ? e + 1 : raw.length;
      }
      const json = raw.slice(next, bodyEnd).trim();
      const oversize = exceedsFenceLimit(json);
      let error: FenceError | undefined;
      if (oversize) error = 'oversize';
      else if (!closed && final) error = 'unclosed';
      if (error && !keepFailed) {
        text += raw.slice(pos, after); // degrades to an ordinary text block
      } else {
        flushText();
        segments.push({ kind, json, complete: closed, ...(error ? { error } : {}) });
      }
      pos = after;
      continue;
    }

    if (!terminated && !final && isPartialOpener(line)) break; // hold the tail back

    const other = OTHER_OPENER_RE.exec(line);
    if (other) otherFence = other[1].length;
    text += raw.slice(pos, next);
    pos = next;
  }
  flushText();
  return segments;
}

// ---- early component detection --------------------------------------------------------------

const EARLY_NAME_RE = /^\{\s*"component"\s*:\s*"([A-Za-z][A-Za-z0-9]{0,63})"/;

/**
 * The component name of a (possibly partial) `ano-ui` body that starts with `{"component":"Name"`.
 * Whitespace tolerant; the closing quote is required so `"Money` is not yet a name.
 */
export function detectComponentName(partialJson: string): string | null {
  const match = EARLY_NAME_RE.exec(partialJson);
  return match ? match[1] : null;
}

// ---- turning a complete fence into a tool call ------------------------------------------------

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]),
);

const uiEnvelope = z.object({
  component: z.string().regex(COMPONENT_NAME_RE),
  props: z.record(jsonValue).optional(),
});

const defineEnvelope = z
  .record(jsonValue)
  .refine((o) => typeof o.name === 'string' && COMPONENT_NAME_RE.test(o.name), { message: 'needs a string name' });

/**
 * `ok: true` with props, or `ok: false` with a reason, or null for a component the validator does
 * not know (the instance passes through unvalidated). Same shape as ComponentRegistry.validateProps.
 */
export type FenceValidator = (
  component: string,
  props: JsonObject,
) => { ok: true; props: JsonObject } | { ok: false; error: string } | null;

export type ToolCallSpec = { name: string; args: JsonObject };

export type FenceDecode = { ok: true; call: ToolCallSpec } | { ok: false; error: string };

function describeZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? issue.path.join('.') : 'fence';
  return `${where}: ${issue.message}`.slice(0, 160);
}

/** Decode a settled fence into its tool call, or say why it cannot be used. Never throws. */
export function decodeFence(seg: FenceSegment, validate?: FenceValidator): FenceDecode {
  if (seg.error === 'oversize') return { ok: false, error: `fence larger than ${MAX_FENCE_BYTES} bytes` };
  if (!seg.complete) return { ok: false, error: 'fence was not closed' };
  let value: unknown;
  try {
    value = JSON.parse(seg.json);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (seg.kind === 'canvas') {
    const parsed = z.record(jsonValue).safeParse(value);
    if (!parsed.success) return { ok: false, error: 'canvas update must be a JSON object' };
    return { ok: true, call: { name: CANVAS_TOOL_NAME, args: parsed.data } };
  }
  if (seg.kind === 'define') {
    const parsed = defineEnvelope.safeParse(value);
    if (!parsed.success) return { ok: false, error: describeZodError(parsed.error) };
    return { ok: true, call: { name: DEFINE_TOOL_NAME, args: parsed.data } };
  }
  const parsed = uiEnvelope.safeParse(value);
  if (!parsed.success) return { ok: false, error: describeZodError(parsed.error) };
  const { component } = parsed.data;
  const props = parsed.data.props ?? {};
  const name = `${RENDER_TOOL_PREFIX}${component}`;
  if (!validate) return { ok: true, call: { name, args: props } };
  try {
    const verdict = validate(component, props);
    if (verdict === null) return { ok: true, call: { name, args: props } };
    if (!verdict.ok) return { ok: false, error: verdict.error.slice(0, 160) };
    return { ok: true, call: { name, args: verdict.props } };
  } catch {
    return { ok: false, error: 'props validation failed' };
  }
}

/** The tool call of a fence, or null when it is incomplete or unusable. */
export function toolCallFor(seg: FenceSegment): ToolCallSpec | null {
  const decoded = decodeFence(seg);
  return decoded.ok ? decoded.call : null;
}
