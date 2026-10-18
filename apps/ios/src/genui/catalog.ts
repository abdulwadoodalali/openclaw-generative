// The catalog brief the app prepends to chat messages so the model knows which native components
// it can draw and how to define new ones, plus the [ui-event] text convention. Pure TypeScript.
import { z } from 'zod';
import { utf8Bytes } from './definition.ts';
import { LIMITS, SPACING, TONES, UI_EVENT_PREFIX, type JsonValue, type PropSchema, type RegistryEntry } from './types.ts';

/** What the catalog needs from a registry (structural, so tests need no full ComponentRegistry). */
export type CatalogSource = { list(): RegistryEntry[]; readonly catalogVersion: number };

const CONTEXT_OPEN = '<ano-ui-context>';
const CONTEXT_CLOSE = '</ano-ui-context>';
const DELTA_OPEN = '[catalog-update]';
const DELTA_CLOSE = '[/catalog-update]';
const BLOCK_SEPARATOR = '\n\n';
/** Data behind a locked-canvas tap (src/lib/canvasAsk.ts): sent to Ano at the end of the message, never shown. */
export const TAPPED_OPEN = '<ano-tapped>';
export const TAPPED_CLOSE = '</ano-tapped>';
const FENCE = '```';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);

/** Model-authored text goes into the brief on one line, without our wrapper markers. */
function oneLine(text: string): string {
  return text
    .replace(/\[\/catalog-update\]|[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short form of a description for the brief: first sentence, at most 100 characters. */
function briefDescription(description: string): string {
  const text = oneLine(description);
  const firstSentence = text.split(/\.\s/, 1)[0].replace(/\.$/, '');
  return firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}...` : firstSentence;
}

function typeLabel(schema: PropSchema, depth: number): string {
  switch (schema.type) {
    case 'string':
    case 'number':
    case 'integer':
      if (schema.enum) {
        if (schema.enum.join() === TONES.join()) return 'tone';
        if (schema.enum.join() === SPACING.join()) return 'spacing';
        return schema.enum.map((value) => JSON.stringify(value)).join('|');
      }
      return schema.type === 'integer' ? 'int' : schema.type;
    case 'boolean':
      return 'boolean';
    case 'array':
      return `${schema.items ? typeLabel(schema.items, depth + 1) : 'any'}[]`;
    case 'object':
      return schema.properties && depth < 2 ? `{${propList(schema, depth + 1, true)}}` : 'object';
  }
}

function propList(schema: PropSchema, depth: number, withTypes: boolean): string {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .map(([key, child]) => {
      const name = oneLine(key);
      const mark = required.has(key) ? '*' : '?';
      return withTypes ? `${name}${mark}: ${typeLabel(child, depth)}` : `${name}${required.has(key) ? '*' : ''}`;
    })
    .join(', ');
}

/** `Name(label*: string, items?: {id*: string}[]) - description`; compact keeps prop names only. */
function componentLine(entry: RegistryEntry, compact: boolean): string {
  const props = propList(entry.props, 0, !compact);
  return `- ${entry.name}(${props}) - ${briefDescription(entry.description)}`;
}

/** Room kept for agent-defined components even when the built-ins alone fill the budget. */
const USER_FLOOR_BYTES = 768;

/**
 * Lays the component lines out under the budget. Built-ins always stay in full. User components are
 * ordered newest change first; while the text is too long the least recently changed ones first lose
 * their prop types, then are dropped from the list. The limit is LIMITS.catalogBriefBytes, or the
 * built-ins-only size plus USER_FLOOR_BYTES when the built-ins alone nearly fill it.
 */
function fitComponents(
  builtins: RegistryEntry[],
  user: RegistryEntry[],
  render: (lines: string[]) => string,
): string {
  const sorted = [...user].sort((a, b) => b.changedAt - a.changedAt || a.name.localeCompare(b.name));
  const layout = (listed: number, detailed: number): string => {
    const lines = [
      ...builtins.map((entry) => componentLine(entry, false)),
      ...sorted.slice(0, listed).map((entry, index) => componentLine(entry, index >= detailed)),
    ];
    if (listed < sorted.length) {
      lines.push(`(${sorted.length - listed} older components not listed; they still work if you remember them)`);
    }
    return render(lines);
  };
  const limit = sorted.length === 0 ? LIMITS.catalogBriefBytes : Math.max(LIMITS.catalogBriefBytes, utf8Bytes(layout(0, 0)) + USER_FLOOR_BYTES);
  let detailed = sorted.length;
  let listed = sorted.length;
  for (;;) {
    const text = layout(listed, detailed);
    if (utf8Bytes(text) <= limit || listed === 0) return text;
    if (detailed > 0) detailed -= 1;
    else listed -= 1;
    if (detailed > listed) detailed = listed;
  }
}

const FIXED_HEAD = [
  'Draw native UI cards by putting a block on its own lines between prose:',
  `${FENCE}ano-ui`,
  '{"component":"Name","props":{...}}',
  FENCE,
  'Props follow the signatures (* = required). Figures not from a real tool or the vault MUST carry "sample": true and be called sample data.',
  'No raw tags or markdown tricks: open/close sections are a Collapsible; nest via "children".',
  'Components:',
];

const FIXED_TAIL = [
  'No fitting component? Define one first (data only), then use it; a higher "version" replaces yours:',
  `${FENCE}ano-define`,
  '{"name":"NameV2","version":1,"description":"..","props":{"type":"object","required":["x"],"properties":{"x":{"type":"string"}}},"root":"n1","nodes":{"n1":{"t":"Card","children":["n2"]},"n2":{"t":"Text","text":"{{x}}"}},"actions":["open"]}',
  FENCE,
  'Prop types: string number integer boolean array object, enum, depth 3. Node "t" is a primitive (other fields are props) or a component: Stack{dir,gap,align,justify,wrap} Grid{cols,gap} Card{title,tone} Section{title,footer} Text{text,variant:body|lead|caption|label|mono,tone,bold} Heading{text,level} Stat{label,value,delta,tone} Badge{text,tone} Icon{name} Progress{value,max,variant:bar|ring} Chart{kind:line|area|bar,series,budgetLine} Image{uri} Divider Spacer Pressable{action} Button{label,action,variant} Segmented{options,bind,action} Checkbox{checked,action} List{items,template} Embed{items}.',
  'Bindings: {{prop}} {{a.b}} {{item.x}} {{index}} {{state.k}} with |money |percent |date |upper |round; "if":"{{x}}" shows a node if truthy; List repeats node "template". tone: default|accent|household|muted|danger. spacing: 0 4 8 12 16 24.',
  'Button/Pressable/Checkbox/Segmented take "action":{"name":"open","payload":{"id":"{{item.id}}"}}, listed in "actions" (max 8). Image uri https only.',
  `Save a canvas if asked: ${FENCE}ano-canvas {"op":"create","title":"..","blocks":[{component,props}]}${FENCE}; his Home: {"canvas":"home","summary":"Added X to Home","blocks":[..]}, silently (never explain how).`,
  `A tap reaches you as ${UI_EVENT_PREFIX} {"component":"Name","event":"open","id":"g1"}: answer briefly.`,
];

/** The whole `<ano-ui-context>` block for the first message of a thread. */
export function buildCatalogBrief(registry: CatalogSource): string {
  const entries = registry.list();
  return fitComponents(
    entries.filter((entry) => entry.builtin),
    entries.filter((entry) => !entry.builtin),
    (lines) =>
      [CONTEXT_OPEN, ...FIXED_HEAD, ...lines, ...FIXED_TAIL, `catalogVersion: ${registry.catalogVersion}`, CONTEXT_CLOSE].join('\n'),
  );
}

/** A `[catalog-update]` block listing components changed after `sinceVersion`; null when none. */
export function buildCatalogDelta(registry: CatalogSource, sinceVersion: number): string | null {
  const changed = registry.list().filter((entry) => entry.changedAt > sinceVersion);
  if (changed.length === 0) return null;
  return fitComponents([], changed, (lines) =>
    [`${DELTA_OPEN} catalogVersion: ${registry.catalogVersion}. New or changed components:`, ...lines, DELTA_CLOSE].join('\n'),
  );
}

/** Puts the preamble (brief, then delta) before the user's text; `cleanUserText` strips it exactly. */
export function decorateUserText(text: string, parts: { brief?: string; delta?: string | null }): string {
  const blocks = [parts.brief, parts.delta].filter((block): block is string => !!block);
  if (blocks.length === 0) return text;
  return [...blocks, ...(text ? [text] : [])].join(BLOCK_SEPARATOR);
}

function stripLeadingBlock(text: string, open: string, close: string): string {
  if (!text.startsWith(open)) return text;
  const end = text.indexOf(close);
  if (end < 0) return text;
  const rest = text.slice(end + close.length);
  return rest.startsWith(BLOCK_SEPARATOR) ? rest.slice(BLOCK_SEPARATOR.length) : rest.replace(/^\n+/, '');
}

/** Drops a trailing `<ano-tapped>` block (locked-canvas tap data) from a user's text. */
function stripTappedBlock(text: string): string {
  const start = text.lastIndexOf(TAPPED_OPEN);
  if (start < 0 || !text.trimEnd().endsWith(TAPPED_CLOSE)) return text;
  return text.slice(0, start).trimEnd();
}

/** Undoes `decorateUserText` for user rows loaded from history, and drops tap data; `[ui-event]` rows are hidden. */
export function cleanUserText(text: string): { text: string; hidden?: boolean } {
  const stripped = stripTappedBlock(stripLeadingBlock(stripLeadingBlock(text, CONTEXT_OPEN, CONTEXT_CLOSE), DELTA_OPEN, DELTA_CLOSE));
  if (stripped.trimStart().startsWith(UI_EVENT_PREFIX)) return { text: stripped, hidden: true };
  return { text: stripped };
}

/** `[ui-event] {"component":..,"event":..,...payload}` as single-line JSON, payload spread flat. */
export function formatUiEvent(action: { component: string; event: string; payload?: Record<string, JsonValue> }): string {
  const payload = Object.fromEntries(Object.entries(action.payload ?? {}).filter(([key]) => key !== 'component' && key !== 'event'));
  return `${UI_EVENT_PREFIX} ${JSON.stringify({ component: action.component, event: action.event, ...payload })}`;
}

/** Inverse of `formatUiEvent`; null for anything else. */
export function parseUiEvent(text: string): { component: string; event: string; payload: Record<string, JsonValue> } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(UI_EVENT_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(UI_EVENT_PREFIX.length));
  } catch {
    return null;
  }
  const parsed = z.record(JsonValueSchema).safeParse(raw);
  if (!parsed.success) return null;
  const { component, event, ...payload } = parsed.data;
  if (typeof component !== 'string' || typeof event !== 'string') return null;
  return { component, event, payload };
}
