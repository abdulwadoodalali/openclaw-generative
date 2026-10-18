// Best-effort generic view of a component the app cannot draw (unknown name, or props that failed
// validation). The model's props are turned into a small view model: a title, scalar label/value
// rows, list rows, bullets and nested component instances, so the user reads the content instead
// of raw JSON. Pure TypeScript (the React side is components/GenericCard.tsx).

export type GenericRow = { title: string; secondary?: string };
export type GenericNode = { component: string; props: Record<string, unknown> };
export type GenericSection =
  | { kind: 'fields'; rows: Array<{ label: string; value: string }> }
  | { kind: 'bullets'; label?: string; items: string[] }
  | { kind: 'rows'; label?: string; rows: GenericRow[] }
  | { kind: 'nodes'; label?: string; nodes: GenericNode[] };
export type GenericModel = { title: string; sections: GenericSection[] };

const TITLE_KEYS = ['title', 'label', 'name', 'text', 'heading', 'summary'] as const;
const CARD_TITLE_KEYS = ['title', 'label', 'name'] as const;
const MAX_ITEMS = 50;
const MAX_NODES = 24;
const MAX_TEXT = 240;
const COMPONENT_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isInstance(value: unknown): value is Rec & { component: string } {
  return isRecord(value) && typeof value.component === 'string' && COMPONENT_RE.test(value.component);
}

/** `KanbanBoard` -> "Kanban board", `due_date` -> "Due date". */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function scalarText(value: string | number | boolean): string {
  const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value).replace(/\s+/g, ' ').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

function nonEmptyScalar(value: unknown): value is string | number | boolean {
  return isScalar(value) && (typeof value !== 'string' || value.trim() !== '');
}

function joinScalars(values: unknown[]): string {
  return values.filter(nonEmptyScalar).map(scalarText).join(', ');
}

/** One list row from an object: a title-ish field, then a secondary line from what is left. */
function rowFromRecord(item: Rec): GenericRow {
  const titleKey = TITLE_KEYS.find((key) => nonEmptyScalar(item[key]));
  const rest = Object.entries(item).filter(([key, value]) => key !== titleKey && key !== 'id' && key !== 'key' && nonEmptyScalar(value));
  let title = titleKey ? scalarText(item[titleKey] as string | number | boolean) : '';
  if (!title && rest.length > 0) {
    title = scalarText(rest[0][1] as string | number | boolean);
    rest.shift();
  }
  const parts = rest.slice(0, 2).map(([, value]) => scalarText(value as string | number | boolean));
  let secondary = parts.join(' \u00b7 ');
  if (!secondary) {
    for (const value of Object.values(item)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      secondary = value.every(nonEmptyScalar) ? joinScalars(value) : `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
      break;
    }
  }
  return { title: title || 'Item', ...(secondary ? { secondary } : {}) };
}

function nodeFrom(value: Rec & { component: string }): GenericNode {
  return { component: value.component, props: isRecord(value.props) ? value.props : {} };
}

function arraySection(label: string | undefined, array: unknown[]): GenericSection | null {
  const items = array.filter((item) => item !== null && item !== undefined);
  if (items.length === 0) return null;
  if (items.every(isInstance)) return { kind: 'nodes', ...(label ? { label } : {}), nodes: items.slice(0, MAX_NODES).map((item) => nodeFrom(item as Rec & { component: string })) };
  if (items.every(nonEmptyScalar)) {
    return { kind: 'bullets', ...(label ? { label } : {}), items: items.slice(0, MAX_ITEMS).map((item) => scalarText(item as string | number | boolean)) };
  }
  const rows = items.slice(0, MAX_ITEMS).map((item): GenericRow => {
    if (isRecord(item)) return rowFromRecord(item);
    if (Array.isArray(item)) return { title: joinScalars(item) || `${item.length} items` };
    return { title: scalarText(item as string | number | boolean) };
  });
  return { kind: 'rows', ...(label ? { label } : {}), rows };
}

/** The view model for `component` drawn from `props`. Never throws. */
export function buildGenericModel(component: string, props: Rec): GenericModel {
  const titleKey = CARD_TITLE_KEYS.find((key) => nonEmptyScalar(props[key]));
  const title = titleKey ? scalarText(props[titleKey] as string | number | boolean) : humanize(component);

  const fields: Array<{ label: string; value: string }> = [];
  const others: GenericSection[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === titleKey || key === 'component' || key.startsWith('__') || value === null || value === undefined) continue;
    const label = key === 'children' ? undefined : humanize(key);
    if (isScalar(value)) {
      if (nonEmptyScalar(value)) fields.push({ label: label ?? humanize(key), value: scalarText(value) });
    } else if (Array.isArray(value)) {
      const section = arraySection(label, value);
      if (section) others.push(section);
    } else if (isInstance(value)) {
      others.push({ kind: 'nodes', ...(label ? { label } : {}), nodes: [nodeFrom(value)] });
    } else if (isRecord(value)) {
      // A plain object: its scalars become rows ("Owner name"), deeper structure is dropped.
      for (const [sub, inner] of Object.entries(value)) {
        if (nonEmptyScalar(inner)) fields.push({ label: `${humanize(key)} ${sub.length ? humanize(sub).toLowerCase() : ''}`.trim(), value: scalarText(inner) });
      }
    }
  }
  return { title, sections: [...(fields.length > 0 ? [{ kind: 'fields', rows: fields } as GenericSection] : []), ...others] };
}

/**
 * The props of a fence body (`{"component":"X","props":{...}}`) or of a bare props object, when it
 * parses as a JSON object. Null for anything that is not JSON (the raw text card then applies).
 */
export function propsFromSource(raw: string): Rec | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.component === 'string' && 'props' in value) return isRecord(value.props) ? value.props : {};
  return value;
}
