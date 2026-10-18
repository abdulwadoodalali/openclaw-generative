// The canvas wire format: what the agent sends in an ```ano-canvas fence (parsed and validated here)
// and the preamble the app prepends to "edit by asking" turns. Pure TypeScript.
import { isFallbackArgs } from '../genui/types.ts';
import { ENV_USER_NAME, userRef } from '../env.ts';
import {
  MAX_BLOCKS,
  MAX_SUMMARY_LENGTH,
  checkBlocks,
  checkTitle,
  isPlainObject,
  type Canvas,
  type CanvasBlock,
  type CanvasScope,
} from './types.ts';

export const HOME_CANVAS_ID = 'home';

/** What the empty Home card sends through the Customize runner. */
export const HOME_SETUP_PROMPT = 'Set up my Home: what I should see first each day.';

/** RFC 6902 subset over `{ title, blocks }`. */
export type PatchOp =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string };

export type CanvasUpdate = {
  /** Default 'update' inside a canvas turn; 'create' makes a new canvas (used from chat). */
  op?: 'create' | 'update';
  /** From chat only: which existing canvas an update targets. Only "home" is accepted (see CHAT_TARGETS). */
  canvas?: string;
  title?: string;
  summary?: string;
  scope?: CanvasScope;
  pin?: boolean;
  /** Full replacement. */
  blocks?: CanvasBlock[];
  /** Or a patch against version `base`. */
  base?: number;
  ops?: PatchOp[];
};

export type ParsedCanvasUpdate = { ok: true; update: CanvasUpdate } | { ok: false; error: string };

const MAX_OPS = 100;
const PATH_ROOT_RE = /^\/(title|blocks)(\/|$)/;
/** Canvases a chat may change in place with `{"canvas": id, ...}`. Others are changed from their own screen. */
export const CHAT_TARGETS: readonly string[] = [HOME_CANVAS_ID];

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function checkPath(path: unknown, where: string): string | null {
  if (typeof path !== 'string' || !PATH_ROOT_RE.test(path)) {
    return `${where} must be a JSON pointer starting with /title or /blocks`;
  }
  return null;
}

function parseOp(raw: unknown, index: number): { ok: true; op: PatchOp } | { ok: false; error: string } {
  const where = `ops[${index}]`;
  if (!isPlainObject(raw)) return fail(`${where} must be an object`);
  const kind = raw.op;
  if (kind === 'add' || kind === 'replace') {
    const bad = checkPath(raw.path, `${where}.path`);
    if (bad) return fail(bad);
    if (!('value' in raw)) return fail(`${where}.value is required for ${kind}`);
    return { ok: true, op: { op: kind, path: raw.path as string, value: raw.value } };
  }
  if (kind === 'remove') {
    const bad = checkPath(raw.path, `${where}.path`);
    if (bad) return fail(bad);
    return { ok: true, op: { op: 'remove', path: raw.path as string } };
  }
  if (kind === 'move') {
    const badFrom = checkPath(raw.from, `${where}.from`);
    if (badFrom) return fail(badFrom);
    const badPath = checkPath(raw.path, `${where}.path`);
    if (badPath) return fail(badPath);
    return { ok: true, op: { op: 'move', from: raw.from as string, path: raw.path as string } };
  }
  return fail(`${where}.op must be add, replace, remove or move`);
}

/**
 * A stable key for one parsed update: the same update (same target, title, blocks, ops...) always
 * gives the same key, so a chat that is reloaded from history does not create or apply it twice.
 * FNV-1a over the JSON of the parsed update (its fields are always built in the same order).
 */
export function updateKey(update: CanvasUpdate): string {
  const json = JSON.stringify(update);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${json.length.toString(16)}`;
}

/** Validates an untrusted `canvas_update` tool-call argument object. Errors are written for the model and the user. */
export function parseCanvasUpdate(raw: unknown): ParsedCanvasUpdate {
  if (isFallbackArgs(raw)) return fail(`The ano-canvas block was not valid JSON (${raw.__error})`);
  if (!isPlainObject(raw)) return fail('A canvas update must be a JSON object');

  const update: CanvasUpdate = {};

  if (raw.op !== undefined) {
    if (raw.op !== 'create' && raw.op !== 'update') return fail('op must be "create" or "update"');
    update.op = raw.op;
  }
  if (raw.canvas !== undefined) {
    if (typeof raw.canvas !== 'string' || !CHAT_TARGETS.includes(raw.canvas)) return fail(`canvas must be one of: ${CHAT_TARGETS.join(', ')}`);
    if (update.op === 'create') return fail('A new canvas cannot target an existing one; drop "canvas" or use op "update"');
    update.canvas = raw.canvas;
  }
  if (raw.title !== undefined) {
    const bad = checkTitle(raw.title);
    if (bad) return fail(bad);
    update.title = (raw.title as string).trim();
  }
  if (raw.summary !== undefined) {
    if (typeof raw.summary !== 'string') return fail('summary must be a string');
    const summary = raw.summary.trim().slice(0, MAX_SUMMARY_LENGTH);
    if (summary) update.summary = summary;
  }
  if (raw.scope !== undefined) {
    if (raw.scope !== 'private' && raw.scope !== 'household') return fail('scope must be "private" or "household"');
    update.scope = raw.scope;
  }
  if (raw.pin !== undefined) {
    if (typeof raw.pin !== 'boolean') return fail('pin must be true or false');
    update.pin = raw.pin;
  }
  if (raw.blocks !== undefined) {
    const bad = checkBlocks(raw.blocks);
    if (bad) return fail(bad);
    update.blocks = (raw.blocks as CanvasBlock[]).map((block) => ({ component: block.component, props: block.props }));
  }
  if (raw.base !== undefined) {
    if (typeof raw.base !== 'number' || !Number.isInteger(raw.base) || raw.base < 0) return fail('base must be a version number');
    update.base = raw.base;
  }
  if (raw.ops !== undefined) {
    if (!Array.isArray(raw.ops)) return fail('ops must be an array');
    if (raw.ops.length > MAX_OPS) return fail(`ops has ${raw.ops.length} entries, the maximum is ${MAX_OPS}`);
    const ops: PatchOp[] = [];
    for (let i = 0; i < raw.ops.length; i += 1) {
      const parsed = parseOp(raw.ops[i], i);
      if (!parsed.ok) return parsed;
      ops.push(parsed.op);
    }
    update.ops = ops;
  }

  if (update.blocks !== undefined && update.ops !== undefined) return fail('Send either blocks (rewrite) or ops (patch), not both');
  if (update.op === 'create') {
    if (update.title === undefined) return fail('A new canvas needs a title');
    if (update.ops !== undefined) return fail('A new canvas takes blocks, not ops');
    return { ok: true, update: { ...update, blocks: update.blocks ?? [] } };
  }
  if (
    update.title === undefined &&
    update.blocks === undefined &&
    update.ops === undefined &&
    update.scope === undefined &&
    update.pin === undefined
  ) {
    return fail('The canvas update changes nothing: give blocks, ops, title, scope or pin');
  }
  return { ok: true, update };
}

// ---- edit-turn preamble -----------------------------------------------------------------------

const CONTEXT_OPEN = '<ano-canvas-context>';
const CONTEXT_CLOSE = '</ano-canvas-context>';
const BLOCKS_BUDGET_CHARS = 6000;
const FENCE = '```';

/** JSON that cannot contain the closing marker (`<` is escaped, which JSON.parse reads back). */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Blocks as JSON within the budget: keeps leading blocks, drops the rest and says so. */
function blocksView(blocks: CanvasBlock[]): { json: string; omitted: number[] } {
  const kept: string[] = [];
  const omitted: number[] = [];
  let used = 2;
  blocks.forEach((block, index) => {
    const json = safeJson(block);
    if (omitted.length === 0 && used + json.length + 1 <= BLOCKS_BUDGET_CHARS) {
      kept.push(json);
      used += json.length + 1;
    } else {
      omitted.push(index);
    }
  });
  return { json: `[${kept.join(',')}]`, omitted };
}

export type CanvasTurnMode = 'edit' | 'refresh' | 'event';

/** The visible user text of a refresh turn (the canvas context rides in front of it, hidden on reload). */
export const REFRESH_PROMPT = 'Refresh this canvas';

const MAX_CONTEXT_ORIGIN_CHARS = 1000;

const REFRESH_RULES =
  'This is a refresh, not an edit request. Re-read every figure and list from its real source (tools, vault, the origin question). Keep the same components in the same order; only values change. Use real data only; never invent tasks, events or amounts. Summary like "Refreshed: 3 tasks done, spend updated".';

/** From this local hour the Home brief also looks ahead to tomorrow. */
export const EVENING_HOUR = 18;

/** The Home screen rules, naming the user (EXPO_PUBLIC_ANO_USER_NAME) when known. */
function homeRules(userName: string | null): string {
  return (
    `This is ${userRef(userName)}'s Home screen. Ano is their chief of staff: Home speaks first only when something needs their decision and shows receipts for what their agents did. No feed, news, tips or filler. ` +
    'Use real data only (tools, vault, tasks, calendar); never invent tasks, events, people or amounts. ' +
    'Write BriefItem blocks, each with a "kind", in this order: decide and answer cards (most urgent first, at most 3 together), headsUp (at most 3), one today, handled, at most one moving, then any other catalog blocks that help (MoneyGlance, StatRow, TaskList). No Heading blocks: Home labels its sections itself. ' +
    'Kinds: decide = an agent waits on their OK for a payment, send, booking or change; answer = an agent is blocked on a question only they can answer, with 2 to 4 short "options"; headsUp = something they should act on soon (a deadline within 72 hours, a conflict or an anomaly); moving = one goal or deal with a deadline 7 to 90 days out or no progress for 14 days; ' +
    'handled = a receipt for something an agent did since they last looked at Home (what, which agent, when; drop receipts older than a day); today = their next events, only when they have some, {"kind":"today","title":"Today","events":[{"time":"14:00","title":"Dentist"}]} with 24-hour times. ' +
    'Card fields: "id" stable across refreshes (the same thing keeps the same id, for example "hydro-bill-oct"); "title" the claim, with a name and a number or a date ("Hydro bill $214 due Friday"); "why" why now, under 100 characters, required for decide, answer and headsUp; "stake" under 12 characters ("$214", "Fri", "2 days"); "agent" the id of the agent the card belongs to; ' +
    '"source" where the fact came from in 2 to 4 plain words a person would say ("Budget", "Garden project"), never a file name, path or date; "at" the ISO time of the fact or action; "action" {"label":"a short verb","prompt":"what to ask Ano"} on every card except handled and today. A decide, answer or headsUp card without a why or an action is not shown. ' +
    'A day with nothing that needs them is a good day: leave decide and answer out rather than padding them, and never dress up a heads-up as a decision.'
  );
}

const HOME_EVENING_RULES =
  'It is evening: end with one BriefItem {"kind":"tomorrow"} whose title says what comes first tomorrow ("Tomorrow: dentist at 9:00"), with an action to prepare for it.';

const HOME_REFRESH_RULES =
  'This is the daily refresh of Home, not a small edit. Rebuild the cards for today from their real sources (tools, vault, tasks, calendar); you may change, add or drop blocks. Keep the id of a card that is still about the same thing, and drop cards that no longer apply.';

/**
 * The preamble for one turn on `canvas`: its current state, who operates it, where it came from and
 * the reply rules for `mode`. Ends with a newline. Edit and event turns only happen on unlocked canvases.
 * `now` only matters for the Home canvas (the evening guidance), `userName` names the user there.
 */
export function buildCanvasContext(
  canvas: Canvas,
  mode: CanvasTurnMode,
  now: Date = new Date(),
  userName: string | null = ENV_USER_NAME,
): string {
  const view = blocksView(canvas.blocks);
  const lines = [CONTEXT_OPEN];
  lines.push(
    mode === 'refresh'
      ? `The app is refreshing one of the user's canvases. Canvas id: ${canvas.id}. Title: ${safeJson(canvas.title)}. Version: ${canvas.version}. Scope: ${canvas.scope}.`
      : `The user is looking at one of their canvases and is asking you to change it. Canvas id: ${canvas.id}. Title: ${safeJson(canvas.title)}. Version: ${canvas.version}. Scope: ${canvas.scope}.`,
  );
  const { name, instructions } = canvas.agent;
  if (name) lines.push(`You are working as ${safeJson(name)}, the agent the user made for this canvas.`);
  if (instructions) lines.push(`Instructions for this canvas from the user: ${safeJson(instructions)}`);
  if (canvas.origin?.prompt) {
    lines.push(`This canvas came from this question in chat: ${safeJson(canvas.origin.prompt.slice(0, MAX_CONTEXT_ORIGIN_CHARS))}`);
  }
  lines.push(`Current blocks (${canvas.blocks.length}): ${view.json}`);
  if (view.omitted.length > 0) {
    lines.push(
      `Blocks at index ${view.omitted.join(', ')} are not shown (too large). Edit with ops only and never rewrite blocks, or they would be lost.`,
    );
  }
  if (mode === 'refresh') lines.push(canvas.kind === 'home' ? HOME_REFRESH_RULES : REFRESH_RULES);
  lines.push(
    'Reply with one short sentence, then exactly one ' + FENCE + 'ano-canvas fence holding JSON. Either a patch for small edits:',
    `{"summary":"...","base":${canvas.version},"ops":[{"op":"add|replace|remove|move","path":"/blocks/0","value":{...}}]}`,
    'or a full rewrite:',
    '{"summary":"...","blocks":[{"component":"Name","props":{...}}]}',
    `Paths are JSON pointers over {"title","blocks"}: /title, /blocks, /blocks/<index>, /blocks/- (append), /blocks/<index>/props/<key>. move takes "from" and "path". At most ${MAX_BLOCKS} blocks. Add "title" to rename the canvas.`,
    'Each block is {"component","props"} exactly like an ano-ui fence. Use only catalog components or ones you define with ano-define first. summary is a short past-tense phrase such as "Missing moved up, fee deadline added".',
    'Do not put ano-ui fences in your reply; the canvas is only changed by the ano-canvas fence.',
  );
  if (mode === 'event') {
    lines.push('A [ui-event] in this turn means the user tapped something in the canvas: update the canvas accordingly (for example tick a task).');
  }
  if (canvas.kind === 'home') {
    lines.push(homeRules(userName));
    if (now.getHours() >= EVENING_HOUR) lines.push(HOME_EVENING_RULES);
  }
  lines.push(CONTEXT_CLOSE, '');
  return lines.join('\n');
}

/** Removes the leading preamble `buildCanvasContext` produced (used when history reloads). */
export function stripCanvasContext(text: string): string {
  if (!text.startsWith(CONTEXT_OPEN)) return text;
  const end = text.indexOf(CONTEXT_CLOSE);
  if (end < 0) return text;
  return text.slice(end + CONTEXT_CLOSE.length).replace(/^\n+/, '');
}
