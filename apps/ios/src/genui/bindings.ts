// Binding interpolation for agent-defined components. Pure TypeScript, hand-written parser:
// no eval, no Function, no property access outside own enumerable data.
//
// Grammar (one binding): `{{ path }}` or `{{ path | filter | filter }}`
//   path   = identifier ( "." segment )*      segment = [A-Za-z0-9_]+ (array indexes are numeric segments)
//   root   = `item`, `index`, `state`, or any other name = a prop of the instance
//   filter = money | percent | date | upper | round
//
// Semantics:
//   - A string that is exactly one binding returns the raw typed value (`"{{spent}}"` stays a number).
//   - A mixed string interpolates to text (null and undefined become the empty string).
//   - Objects and arrays resolve recursively; other values pass through.
//   - Anything malformed (unclosed `{{`, bad path, unknown filter) stays literal text. Never throws.
//   - The path segments `__proto__`, `constructor` and `prototype` always resolve to undefined, and
//     only own properties are read, so nothing on the prototype chain is reachable.
//   - Bound values are never re-scanned: a prop whose text contains `{{x}}` is shown verbatim.

export type BindingScope = {
  props: Record<string, unknown>;
  item?: unknown;
  index?: number;
  state: Record<string, unknown>;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const FORBIDDEN_SEGMENT_RE = /^(__proto__|constructor|prototype)$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Interpolation text for a bound value. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * Closed filter set. Each filter returns the input unchanged when it cannot apply (non-numeric
 * value, unparseable date), so a bad value shows as itself instead of "NaN".
 *   money    1234.56 -> "$1,235", 410 -> "$410", 12.5 -> "$12.50", -3 -> "-$3" (dollar sign, whole
 *            dollars; cents only for non-whole amounts below 1000)
 *   percent  0.42 -> "42%"; magnitudes above 1 are taken as already percent (42 -> "42%"); one
 *            decimal at most (0.425 -> "42.5%")
 *   date     "2026-10-12" or an ISO date-time -> "Oct 12" (calendar parts are read from the text,
 *            no time zone conversion)
 *   upper    text to upper case
 *   round    nearest integer
 */
export const FILTERS: Record<string, (value: unknown) => unknown> = {
  money(value) {
    const n = asNumber(value);
    if (n === undefined) return value;
    const abs = Math.abs(n);
    const whole = abs >= 1000 || Number.isInteger(abs);
    const text = whole
      ? groupThousands(Math.round(abs))
      : (() => {
          const [intPart, frac] = abs.toFixed(2).split('.');
          return `${groupThousands(Number(intPart))}.${frac}`;
        })();
    return `${n < 0 ? '-' : ''}$${text}`;
  },
  percent(value) {
    const n = asNumber(value);
    if (n === undefined) return value;
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${Math.round(pct * 10) / 10}%`;
  },
  date(value) {
    if (typeof value !== 'string') return value;
    const m = ISO_DATE_RE.exec(value.trim());
    if (!m) return value;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return value;
    return `${MONTHS[month - 1]} ${day}`;
  },
  upper(value) {
    return typeof value === 'string' ? value.toUpperCase() : value;
  },
  round(value) {
    const n = asNumber(value);
    return n === undefined ? value : Math.round(n);
  },
};

function readOwn(source: unknown, key: string): unknown {
  if (FORBIDDEN_SEGMENT_RE.test(key)) return undefined;
  if (source === null || typeof source !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return Reflect.get(source, key);
}

function lookupPath(path: string, scope: BindingScope): unknown {
  const [root, ...rest] = path.split('.');
  if (root === undefined || FORBIDDEN_SEGMENT_RE.test(root)) return undefined;
  let current: unknown;
  if (root === 'item') current = scope.item;
  else if (root === 'index') current = scope.index;
  else if (root === 'state') current = scope.state;
  else current = readOwn(scope.props, root);
  for (const segment of rest) {
    current = readOwn(current, segment);
    if (current === undefined) return undefined;
  }
  return current;
}

/** One `path|filter|filter` expression. `ok: false` for a malformed path or unknown filter. */
function evaluateExpression(expr: string, scope: BindingScope): { ok: true; value: unknown } | { ok: false } {
  const [rawPath = '', ...rawFilters] = expr.split('|');
  const path = rawPath.trim();
  if (!PATH_RE.test(path)) return { ok: false };
  let value = lookupPath(path, scope);
  for (const rawFilter of rawFilters) {
    const name = rawFilter.trim();
    if (!Object.prototype.hasOwnProperty.call(FILTERS, name)) return { ok: false };
    value = FILTERS[name]!(value);
  }
  return { ok: true, value };
}

type Part = { kind: 'text'; text: string } | { kind: 'binding'; expr: string; raw: string };

/** Splits a string into literal text and `{{...}}` bindings. An unclosed `{{` stays literal. */
function splitTemplate(input: string): Part[] {
  const parts: Part[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const open = input.indexOf('{{', cursor);
    if (open === -1) break;
    const close = input.indexOf('}}', open + 2);
    if (close === -1) break;
    if (open > cursor) parts.push({ kind: 'text', text: input.slice(cursor, open) });
    parts.push({ kind: 'binding', expr: input.slice(open + 2, close), raw: input.slice(open, close + 2) });
    cursor = close + 2;
  }
  if (cursor < input.length) parts.push({ kind: 'text', text: input.slice(cursor) });
  return parts;
}

function resolveString(input: string, scope: BindingScope): unknown {
  if (!input.includes('{{')) return input;
  const parts = splitTemplate(input);
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only?.kind === 'binding') {
    const result = evaluateExpression(only.expr, scope);
    return result.ok ? result.value : input;
  }
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      out += part.text;
      continue;
    }
    const result = evaluateExpression(part.expr, scope);
    out += result.ok ? toText(result.value) : part.raw;
  }
  return out;
}

/** Resolves bindings in a string, array or plain object (recursively); other values pass through. */
export function resolveTemplate(value: unknown, scope: BindingScope): unknown {
  if (typeof value === 'string') return resolveString(value, scope);
  if (Array.isArray(value)) return value.map((entry) => resolveTemplate(entry, scope));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_SEGMENT_RE.test(key)) continue;
      out[key] = resolveTemplate(entry, scope);
    }
    return out;
  }
  return value;
}

/**
 * The `if` test of a node. Accepts `{{x}}` or a bare `x` (path with optional filters). Falsy: false,
 * null, undefined, 0, NaN, empty text, empty array, and anything malformed.
 */
export function isTruthyBinding(expr: string, scope: BindingScope): boolean {
  const trimmed = expr.trim();
  const parts = splitTemplate(trimmed);
  const only = parts.length === 1 ? parts[0] : undefined;
  const inner = only?.kind === 'binding' ? only.expr : trimmed;
  const result = evaluateExpression(inner, scope);
  if (!result.ok) return false;
  const { value } = result;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}
