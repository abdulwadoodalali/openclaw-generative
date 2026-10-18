// The words Ano is sent when you tap something on a locked canvas: a human line saying where it
// came from and what was tapped, then the component's data in a trailing <ano-tapped> block so Ano has
// the context. The chat shows only the human line (`cleanUserText` drops the block). Pure TypeScript.
import { isPlainObject, type CanvasBlock } from '../canvas/types.ts';
import { TAPPED_CLOSE, TAPPED_OPEN } from '../genui/catalog.ts';

export type TappedAction = { component: string; name: string; payload: Record<string, unknown> };

const LABEL_KEYS = ['title', 'label', 'name', 'text'] as const;
const MAX_DATA_CHARS = 1200;
const MAX_LABEL_CHARS = 120;
const MAX_DEPTH = 6;

function labelOf(obj: Record<string, unknown>): string | null {
  for (const key of LABEL_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      const label = value.trim();
      return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS)}...` : label;
    }
  }
  return null;
}

/** The object with `id === wanted` inside any array of objects, searched through nested props and children. */
function findItem(value: unknown, wanted: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isPlainObject(entry) && entry.id === wanted) return entry;
    }
    for (const entry of value) {
      const found = findItem(entry, wanted, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      const found = findItem(entry, wanted, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function compact(value: unknown): string {
  const json = JSON.stringify(value) ?? '';
  return json.length > MAX_DATA_CHARS ? `${json.slice(0, MAX_DATA_CHARS)}...` : json;
}

/** Text for a new chat about what was tapped inside `block` on the canvas called `canvasTitle`. */
export function describeTap(canvasTitle: string, block: CanvasBlock, action: TappedAction): string {
  const id = action.payload.id;
  const item = typeof id === 'string' || typeof id === 'number' ? findItem(block.props, id) : null;
  const label = (item ? labelOf(item) : null) ?? labelOf(action.payload) ?? labelOf(block.props) ?? block.component;
  const data = item ?? block.props;
  return `From my "${canvasTitle}" canvas: ${label}\n\n${TAPPED_OPEN}\n${block.component}: ${compact(data)}\n${TAPPED_CLOSE}`;
}
