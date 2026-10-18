// Applies PatchOp[] (an RFC 6902 subset: add, replace, remove, move) to a canvas body `{ title, blocks }`.
// Immutable: the input is never touched, the result is a deep copy. Pure TypeScript.
import type { PatchOp } from './protocol.ts';
import { checkBlocks, checkTitle, type CanvasBlock } from './types.ts';

export type CanvasBody = { title: string; blocks: CanvasBlock[] };
export type PatchResult = { ok: true; body: CanvasBody } | { ok: false; error: string };

type Container = Record<string, unknown> | unknown[];

const FORBIDDEN_KEY_RE = /^(__proto__|constructor|prototype)$/;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parsePointer(path: string): string[] | null {
  if (!path.startsWith('/')) return null;
  return path
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function arrayIndex(segment: string, length: number, allowEnd: boolean): number | null {
  if (allowEnd && segment === '-') return length;
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) return null;
  const index = Number(segment);
  return index < length || (allowEnd && index === length) ? index : null;
}

/** Walks to the container that holds the last segment of `path`. */
function locate(doc: Container, path: string): { parent: Container; key: string } | { error: string } {
  const segments = parsePointer(path);
  if (!segments) return { error: `path ${path} must start with /` };
  let node: unknown = doc;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (Array.isArray(node)) {
      const index = arrayIndex(segment, node.length, false);
      if (index === null) return { error: `path ${path} does not exist (no item ${segment})` };
      node = node[index];
    } else if (typeof node === 'object' && node !== null && !FORBIDDEN_KEY_RE.test(segment) && Object.hasOwn(node, segment)) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return { error: `path ${path} does not exist (nothing at ${segment})` };
    }
  }
  if (typeof node !== 'object' || node === null) return { error: `path ${path} does not exist` };
  const key = segments[segments.length - 1];
  if (!Array.isArray(node) && FORBIDDEN_KEY_RE.test(key)) return { error: `path ${path} is not allowed` };
  if (segments.length === 1 && key !== 'title' && key !== 'blocks') return { error: `path ${path} must be /title or /blocks` };
  return { parent: node as Container, key };
}

function readAt(parent: Container, key: string, path: string): { value: unknown } | { error: string } {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, false);
    return index === null ? { error: `path ${path} does not exist` } : { value: parent[index] };
  }
  return Object.hasOwn(parent, key) ? { value: parent[key] } : { error: `path ${path} does not exist` };
}

function addAt(parent: Container, key: string, value: unknown, path: string): string | null {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, true);
    if (index === null) return `path ${path} is out of range (${parent.length} items)`;
    parent.splice(index, 0, value);
  } else {
    parent[key] = value;
  }
  return null;
}

function removeAt(parent: Container, key: string, path: string): string | null {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, false);
    if (index === null) return `path ${path} does not exist`;
    parent.splice(index, 1);
  } else {
    if (!Object.hasOwn(parent, key)) return `path ${path} does not exist`;
    delete parent[key];
  }
  return null;
}

function applyOne(doc: CanvasBody, op: PatchOp): string | null {
  const root = doc as unknown as Container;
  if (op.op === 'move') {
    const from = locate(root, op.from);
    if ('error' in from) return from.error;
    const source = readAt(from.parent, from.key, op.from);
    if ('error' in source) return source.error;
    const moved = source.value;
    const removed = removeAt(from.parent, from.key, op.from);
    if (removed) return removed;
    // The target is resolved after the removal, as RFC 6902 specifies.
    const to = locate(root, op.path);
    if ('error' in to) return to.error;
    return addAt(to.parent, to.key, moved, op.path);
  }
  const target = locate(root, op.path);
  if ('error' in target) return target.error;
  if (op.op === 'add') return addAt(target.parent, target.key, clone(op.value), op.path);
  if (op.op === 'replace') {
    const existing = readAt(target.parent, target.key, op.path);
    if ('error' in existing) return existing.error;
    if (Array.isArray(target.parent)) target.parent[arrayIndex(target.key, target.parent.length, false) as number] = clone(op.value);
    else target.parent[target.key] = clone(op.value);
    return null;
  }
  return removeAt(target.parent, target.key, op.path);
}

/** Applies `ops` in order to a copy of `body`. Fails when any op does not apply or the result is not a valid canvas body. */
export function applyPatch(body: CanvasBody, ops: readonly PatchOp[]): PatchResult {
  const doc = clone({ title: body.title, blocks: body.blocks });
  for (let i = 0; i < ops.length; i += 1) {
    const problem = applyOne(doc, ops[i]);
    if (problem) return { ok: false, error: `ops[${i}] (${ops[i].op}): ${problem}` };
  }
  const invalid = checkTitle(doc.title, 'title') ?? checkBlocks(doc.blocks, 'blocks');
  if (invalid) return { ok: false, error: `The patch leaves an invalid canvas: ${invalid}` };
  return { ok: true, body: doc };
}

/**
 * Applies a patch written against version `base` to the body at `current`. A stale base is fine when
 * the ops still apply cleanly; when they do not, the error says the canvas changed.
 */
export function applyVersionedPatch(
  body: CanvasBody,
  current: number,
  patch: { ops: readonly PatchOp[]; base?: number },
): PatchResult {
  const result = applyPatch(body, patch.ops);
  if (result.ok || patch.base === undefined || patch.base === current) return result;
  return { ok: false, error: `canvas changed since version ${patch.base} (now version ${current}): ${result.error}` };
}
