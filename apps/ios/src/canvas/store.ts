// The canvas store: saved canvases, their version history, pinning and scope. Every content change
// appends a CanvasVersion (capped), so "undo" and "restore" are just new versions. Observable for
// useSyncExternalStore and persisted through an injected storage. Pure TypeScript.
import { applyVersionedPatch } from './patch.ts';
import { HOME_CANVAS_ID, type CanvasUpdate } from './protocol.ts';
import {
  MAX_BLOCKS,
  MAX_HISTORY,
  MAX_ORIGIN_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  checkBlocks,
  defaultAgent,
  isPlainObject,
  layoutSignature,
  mergeAgent,
  sameAgent,
  type Canvas,
  type CanvasAgent,
  type CanvasAuthor,
  type CanvasBlock,
  type CanvasScope,
  type CanvasVersion,
} from './types.ts';

export type CanvasStorage = {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
};

export type CanvasCreateInput = {
  title: string;
  blocks: CanvasBlock[];
  by: CanvasAuthor;
  scope?: CanvasScope;
  pinned?: boolean;
  summary?: string;
  id?: string;
  kind?: 'user' | 'home';
  /** Default: locked when the canvas starts with blocks (pinned from chat, built by Ano), unlocked for 'home' and empty canvases. */
  locked?: boolean;
  origin?: Canvas['origin'];
  agent?: Partial<CanvasAgent>;
};

export type CanvasUpdateResult = { ok: true; canvas: Canvas } | { ok: false; error: string };

const STORE_FORMAT = 1;
const DEFAULT_TITLE = 'Untitled canvas';

function clampTitle(title: string): string {
  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH).trim();
  return trimmed || DEFAULT_TITLE;
}

function randomId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isAuthor(value: unknown): value is CanvasAuthor {
  return value === 'ano' || value === 'you';
}

function isScope(value: unknown): value is CanvasScope {
  return value === 'private' || value === 'household';
}

function reviveVersion(raw: unknown): CanvasVersion | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || typeof raw.title !== 'string') return null;
  if (checkBlocks(raw.blocks) || typeof raw.at !== 'number' || !isAuthor(raw.by) || typeof raw.summary !== 'string') return null;
  return { version: raw.version, title: raw.title, blocks: raw.blocks as CanvasBlock[], at: raw.at, by: raw.by, summary: raw.summary };
}

const LAYOUT_LOCKED_ERROR = 'layout is locked: keep the same components in the same order and change only their values';

/** Rebuilds the origin of a stored canvas; null when it is missing or unusable. */
function reviveOrigin(raw: unknown): Canvas['origin'] | null {
  if (!isPlainObject(raw) || typeof raw.prompt !== 'string' || typeof raw.at !== 'number') return null;
  const origin: NonNullable<Canvas['origin']> = { prompt: raw.prompt.slice(0, MAX_ORIGIN_PROMPT_LENGTH), at: raw.at };
  if (typeof raw.sessionKey === 'string' && raw.sessionKey) origin.sessionKey = raw.sessionKey;
  return origin;
}

/** Rebuilds one stored canvas; null when it is unusable. Canvases saved before v2 get the defaults (unlocked). The old 'today' kind loads as a plain canvas that `load` turns into 'home'. */
function reviveCanvas(raw: unknown): Canvas | null {
  if (!isPlainObject(raw)) return null;
  const { id, title, scope, pinned, kind, version, updatedAt, updatedBy, summary, blocks, history, sessionKey, locked, agent, origin, lastRefreshedAt } = raw;
  if (typeof id !== 'string' || id.length === 0 || typeof title !== 'string') return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  if (checkBlocks(blocks) || !Array.isArray(history)) return null;
  const versions = history.map(reviveVersion).filter((v): v is CanvasVersion => v !== null);
  const canvasKind = kind === 'home' ? 'home' : 'user';
  const canvas: Canvas = {
    id,
    title,
    scope: isScope(scope) ? scope : 'private',
    pinned: pinned === true,
    kind: canvasKind,
    version,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : 0,
    updatedBy: isAuthor(updatedBy) ? updatedBy : 'you',
    summary: typeof summary === 'string' ? summary : '',
    blocks: blocks as CanvasBlock[],
    history: versions.slice(-MAX_HISTORY),
    locked: locked === true,
    agent: mergeAgent(defaultAgent(canvasKind), agent),
  };
  if (typeof sessionKey === 'string' && sessionKey) canvas.sessionKey = sessionKey;
  const revivedOrigin = reviveOrigin(origin);
  if (revivedOrigin) canvas.origin = revivedOrigin;
  if (typeof lastRefreshedAt === 'number' && Number.isFinite(lastRefreshedAt)) canvas.lastRefreshedAt = lastRefreshedAt;
  return canvas;
}

function emptyHome(at: number): Canvas {
  const title = 'Home';
  return {
    id: HOME_CANVAS_ID,
    title,
    scope: 'private',
    pinned: false,
    kind: 'home',
    version: 1,
    updatedAt: at,
    updatedBy: 'ano',
    summary: 'Created',
    blocks: [],
    history: [{ version: 1, title, blocks: [], at, by: 'ano', summary: 'Created' }],
    locked: false,
    agent: defaultAgent('home'),
  };
}

/** The old Today canvas as the Home canvas: same blocks, history and session, renamed, unlocked, daily refresh. */
function homeFromToday(today: Canvas): Canvas {
  const title = 'Home';
  return {
    ...today,
    id: HOME_CANVAS_ID,
    title,
    kind: 'home',
    pinned: false,
    locked: false,
    history: today.history.map((entry) => ({ ...entry, title })),
    agent: { ...today.agent, refresh: 'daily' },
  };
}

export class CanvasStore {
  /** Resolves once the persisted canvases were read and the 'home' canvas exists. Never rejects. */
  readonly ready: Promise<void>;

  private canvases: Canvas[] = [];
  private snapshot: readonly Canvas[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly storage: CanvasStorage | undefined;
  private readonly now: () => number;
  private readonly newId: () => string;
  private pendingSave: Promise<void> = Promise.resolve();
  /** Saves wait for the initial read, so a change made while loading cannot overwrite stored canvases. */
  private loaded = false;

  constructor(opts: { storage?: CanvasStorage; now?: () => number; newId?: () => string } = {}) {
    this.storage = opts.storage;
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? randomId;
    this.ready = this.load();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The same array reference until a canvas changes. */
  getSnapshot(): readonly Canvas[] {
    return this.snapshot;
  }

  get(id: string): Canvas | undefined {
    return this.canvases.find((canvas) => canvas.id === id);
  }

  create(input: CanvasCreateInput): Canvas {
    const requested = input.id;
    if (requested !== undefined) {
      const existing = this.get(requested);
      if (existing) return existing;
    }
    let id = requested ?? this.newId();
    while (this.get(id)) id = this.newId();
    const at = this.now();
    const title = clampTitle(input.title);
    const summary = input.summary?.trim() || 'Created';
    const kind = input.kind ?? 'user';
    const canvas: Canvas = {
      id,
      title,
      scope: input.scope ?? 'private',
      pinned: input.pinned ?? false,
      kind,
      version: 1,
      updatedAt: at,
      updatedBy: input.by,
      summary,
      blocks: input.blocks,
      history: [{ version: 1, title, blocks: input.blocks, at, by: input.by, summary }],
      locked: input.locked ?? (kind !== 'home' && input.blocks.length > 0),
      agent: mergeAgent(defaultAgent(kind), input.agent),
    };
    const origin = reviveOrigin(input.origin);
    if (origin) canvas.origin = origin;
    this.canvases = [...this.canvases, canvas];
    this.changed();
    return canvas;
  }

  /**
   * Applies a content update (full `blocks`, or `ops` against `base`, plus optional `title`) as a new
   * version. An update that only carries `scope` / `pin` changes those without a new version.
   * With `keepLayout` the update is rejected unless the component structure (names in order,
   * recursively through `props.children`) is unchanged: only values may change.
   */
  applyUpdate(id: string, update: CanvasUpdate, by: CanvasAuthor, opts: { keepLayout?: boolean } = {}): CanvasUpdateResult {
    const canvas = this.get(id);
    if (!canvas) return { ok: false, error: `Canvas ${id} not found` };

    const content = update.blocks !== undefined || update.ops !== undefined || update.title !== undefined;
    let next: Canvas = canvas;
    if (content) {
      let title = canvas.title;
      let blocks = canvas.blocks;
      if (update.ops !== undefined) {
        const patched = applyVersionedPatch({ title, blocks }, canvas.version, { ops: update.ops, base: update.base });
        if (!patched.ok) return { ok: false, error: patched.error };
        title = patched.body.title;
        blocks = patched.body.blocks;
      } else if (update.blocks !== undefined) {
        const invalid = checkBlocks(update.blocks);
        if (invalid) return { ok: false, error: invalid };
        blocks = update.blocks;
      }
      if (update.title !== undefined) title = clampTitle(update.title);
      if (opts.keepLayout && layoutSignature(blocks) !== layoutSignature(canvas.blocks)) {
        return { ok: false, error: LAYOUT_LOCKED_ERROR };
      }
      next = this.withVersion(canvas, { title, blocks }, by, update.summary?.trim() || 'Updated');
    }
    if (update.scope !== undefined && update.scope !== next.scope) next = { ...next, scope: update.scope };
    if (update.pin !== undefined && update.pin !== next.pinned) next = { ...next, pinned: update.pin };
    if (next !== canvas) this.replace(next);
    return { ok: true, canvas: next };
  }

  /** Restores the previous version as a new version ("Undid: <summary>"). Undefined with no earlier version. */
  undo(id: string): Canvas | undefined {
    const canvas = this.get(id);
    const previous = canvas?.history[canvas.history.length - 2];
    if (!canvas || !previous) return undefined;
    const next = this.withVersion(canvas, { title: previous.title, blocks: previous.blocks }, 'you', `Undid: ${canvas.summary}`);
    this.replace(next);
    return next;
  }

  /** Restores a kept version as a new version. Undefined when the canvas or version is gone. */
  restore(id: string, version: number): Canvas | undefined {
    const canvas = this.get(id);
    const target = canvas?.history.find((entry) => entry.version === version);
    if (!canvas || !target) return undefined;
    if (version === canvas.version) return canvas;
    const next = this.withVersion(canvas, { title: target.title, blocks: target.blocks }, 'you', `Restored version ${version}`);
    this.replace(next);
    return next;
  }

  setPinned(id: string, pinned: boolean): void {
    const canvas = this.get(id);
    if (canvas && canvas.pinned !== pinned) this.replace({ ...canvas, pinned });
  }

  setScope(id: string, scope: CanvasScope): void {
    const canvas = this.get(id);
    if (canvas && canvas.scope !== scope) this.replace({ ...canvas, scope });
  }

  /** A rename is a version too, so undo and the history stay consistent with the title. */
  rename(id: string, title: string): void {
    const canvas = this.get(id);
    if (!canvas) return;
    const next = clampTitle(title);
    if (next === canvas.title) return;
    this.replace(this.withVersion(canvas, { title: next, blocks: canvas.blocks }, 'you', `Renamed to ${next}`));
  }

  /** Deletes a user canvas. The 'home' canvas is permanent (use applyUpdate with empty blocks to clear it). */
  remove(id: string): void {
    const canvas = this.get(id);
    if (!canvas || canvas.kind === 'home') return;
    this.canvases = this.canvases.filter((entry) => entry.id !== id);
    this.changed();
  }

  setSessionKey(id: string, key: string): void {
    const canvas = this.get(id);
    if (canvas && canvas.sessionKey !== key) this.replace({ ...canvas, sessionKey: key });
  }

  /** No new version: locking is a setting, not content. */
  setLocked(id: string, locked: boolean): void {
    const canvas = this.get(id);
    if (canvas && canvas.locked !== locked) this.replace({ ...canvas, locked });
  }

  /**
   * Changes the canvas agent (no new version). Sessions belong to one OpenClaw agent, so switching
   * `agentId` forgets the canvas session; the next turn creates a fresh one.
   */
  setAgent(id: string, patch: Partial<CanvasAgent>): void {
    const canvas = this.get(id);
    if (!canvas) return;
    const agent = mergeAgent(canvas.agent, patch);
    if (sameAgent(agent, canvas.agent)) return;
    const next: Canvas = { ...canvas, agent };
    if (agent.agentId !== canvas.agent.agentId) delete next.sessionKey;
    this.replace(next);
  }

  /** Appends blocks as a new version (used by "add to an existing canvas" from chat). */
  append(id: string, blocks: CanvasBlock[], by: CanvasAuthor, summary?: string): CanvasUpdateResult {
    const canvas = this.get(id);
    if (!canvas) return { ok: false, error: `Canvas ${id} not found` };
    const invalid = checkBlocks(blocks);
    if (invalid) return { ok: false, error: invalid };
    if (blocks.length === 0) return { ok: false, error: 'There is nothing to add' };
    if (canvas.blocks.length + blocks.length > MAX_BLOCKS) {
      return { ok: false, error: `The canvas has ${canvas.blocks.length} blocks, adding ${blocks.length} would pass the maximum of ${MAX_BLOCKS}` };
    }
    const label = summary?.trim() || `Added ${blocks.length} ${blocks.length === 1 ? 'card' : 'cards'}`;
    const next = this.withVersion(canvas, { title: canvas.title, blocks: [...canvas.blocks, ...blocks] }, by, label);
    this.replace(next);
    return { ok: true, canvas: next };
  }

  /** Records a successful refresh (no new version). */
  markRefreshed(id: string, at: number = this.now()): void {
    const canvas = this.get(id);
    if (canvas) this.replace({ ...canvas, lastRefreshedAt: at });
  }

  /** Resolves when every pending save has finished (tests, app shutdown). */
  flush(): Promise<void> {
    return this.pendingSave;
  }

  private withVersion(canvas: Canvas, body: { title: string; blocks: CanvasBlock[] }, by: CanvasAuthor, summary: string): Canvas {
    const at = this.now();
    const version = canvas.version + 1;
    const entry: CanvasVersion = { version, title: body.title, blocks: body.blocks, at, by, summary };
    return {
      ...canvas,
      title: body.title,
      blocks: body.blocks,
      version,
      updatedAt: at,
      updatedBy: by,
      summary,
      history: [...canvas.history, entry].slice(-MAX_HISTORY),
    };
  }

  private replace(next: Canvas): void {
    this.canvases = this.canvases.map((canvas) => (canvas.id === next.id ? next : canvas));
    this.changed();
  }

  private changed(): void {
    this.snapshot = [...this.canvases];
    this.persist();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private persist(): void {
    const storage = this.storage;
    if (!storage || !this.loaded) return;
    const json = JSON.stringify({ format: STORE_FORMAT, canvases: this.canvases });
    // Saves are chained so an older snapshot can never overwrite a newer one; failures are swallowed.
    this.pendingSave = this.pendingSave.then(() => storage.save(json)).catch(() => undefined);
  }

  /** Reads storage (garbage or a failing read leaves it empty), keeps anything created meanwhile, ensures 'home'. */
  private async load(): Promise<void> {
    let stored: Canvas[] = [];
    let legacyToday: Canvas | undefined;
    if (this.storage) {
      try {
        const raw = await this.storage.load();
        const parsed: unknown = raw === null ? null : JSON.parse(raw);
        if (isPlainObject(parsed) && Array.isArray(parsed.canvases)) {
          for (const entry of parsed.canvases) {
            const canvas = reviveCanvas(entry);
            if (!canvas) continue;
            // The old Home "Today" canvas is not kept: its content seeds 'home' below.
            if (isPlainObject(entry) && entry.kind === 'today') legacyToday = canvas;
            else stored.push(canvas);
          }
        }
      } catch {
        stored = [];
      }
    }
    const merged = new Map<string, Canvas>();
    for (const canvas of stored) merged.set(canvas.id, canvas);
    for (const canvas of this.canvases) merged.set(canvas.id, canvas);
    this.loaded = true;
    this.canvases = [...merged.values()];
    if (!merged.has(HOME_CANVAS_ID)) {
      const at = this.now();
      this.canvases = [...this.canvases, legacyToday && legacyToday.blocks.length > 0 ? homeFromToday(legacyToday) : emptyHome(at)];
    }
    this.changed();
  }
}
