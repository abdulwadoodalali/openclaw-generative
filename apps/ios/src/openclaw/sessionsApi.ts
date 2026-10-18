export type RequestFn = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<any>;

export type Thread = {
  key: string;
  agentId: string;
  title: string;
  project: string | null;
  updatedAt: number;
  pinned: boolean;
  hasActiveRun: boolean;
  unread: boolean;
  sessionId?: string;
  /** The model this session is pinned to ("<provider>/<id>"), or null for the agent's default. */
  model: string | null;
  /** The thinking level this session is pinned to (e.g. "low"), or null for the agent's default. */
  effort: string | null;
};

export type Project = {
  name: string;
  position: number;
};

export const DEFAULT_THREAD_TITLE = 'New thread';

const MAX_TITLE_LENGTH = 120;
const MAX_PROJECT_LENGTH = 80;
const MAX_PAGES = 5;
const DEFAULT_THREAD_LIMIT = 200;

// Boundary shape from OpenClaw RPC; `any` is required by the exported API contract.
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeTitle(row: Record<string, unknown>): string {
  const label = readString(row.label);
  const displayName = readString(row.displayName);
  const key = readString(row.key);

  if (label && (isUuidLike(label) || label === key)) {
    return DEFAULT_THREAD_TITLE;
  }

  return label || displayName || DEFAULT_THREAD_TITLE;
}

/** The agent a session key belongs to: "agent:finance:dashboard:x" -> "finance". */
export function agentIdOfKey(key: string): string | null {
  const match = /^agent:([^:]+):/.exec(key);
  return match ? match[1] : null;
}

function isAppThreadKey(key: string, agentId: string): boolean {
  const prefix = `agent:${agentId}:`;
  if (!key.startsWith(prefix)) return false;
  if (key === `${prefix}main`) return false;
  if (
    key.includes(':telegram:') ||
    key.includes(':cron:') ||
    key.includes(':subagent:') ||
    key.includes(':group:')
  ) {
    return false;
  }
  return true;
}

/** The session's model override as a `sessions.patch` ref ("<provider>/<id>"), or null. */
function readModelOverride(record: Record<string, unknown>): string | null {
  const model = readString(record.modelOverride);
  if (!model) return null;
  const provider = readString(record.providerOverride);
  return provider && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model;
}

// The gateway row is deliberately untyped at the API boundary. Without `agentId` the row's own agent
// (from its key) is used: that is how the all-agents list maps.
export function mapSessionRow(row: any, agentId?: string): Thread | null {
  if (!row || typeof row !== 'object') return null;
  const record: Record<string, unknown> = row;

  const key = readString(record.key);
  const kind = record.kind;

  const owner = agentId ?? agentIdOfKey(key);
  if (!owner || !isAppThreadKey(key, owner)) return null;
  if (!(kind === undefined || kind === 'direct')) return null;
  if (record.archived === true) return null;

  const category = readString(record.category);
  const hasCategory = category.length > 0;
  const looksLikeAppKey =
    key.includes(':dashboard:') ||
    key.includes(':ios-') ||
    key.includes(':ios:');

  if (!looksLikeAppKey && !hasCategory) return null;

  const updatedAt = readNumber(record.lastActivityAt ?? record.updatedAt ?? 0);

  return {
    key,
    agentId: owner,
    title: normalizeTitle(record),
    project: hasCategory ? category : null,
    updatedAt,
    pinned: record.pinned === true,
    hasActiveRun: record.hasActiveRun === true,
    unread: record.unread === true,
    sessionId: readOptionalString(record.sessionId),
    model: readModelOverride(record),
    effort: readOptionalString(record.thinkingLevel) || null,
  };
}

function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  const message = record.message ?? record.errorMessage ?? '';
  return typeof message === 'string' ? message : String(message);
}

function isLabelInUseError(error: unknown): boolean {
  return /label already in use/i.test(readErrorMessage(error));
}

function createdSessionKey(result: unknown): string {
  if (!result || typeof result !== 'object') {
    throw new Error('sessions.create returned an invalid result');
  }
  const record = result as Record<string, unknown>;
  const direct = readString(record.key);
  if (direct.length > 0) return direct;

  const nestedSession =
    record.session && typeof record.session === 'object'
      ? (record.session as Record<string, unknown>)
      : undefined;
  const fromSession = readString(nestedSession?.key);
  if (fromSession.length > 0) return fromSession;

  const nestedEntry =
    record.entry && typeof record.entry === 'object'
      ? (record.entry as Record<string, unknown>)
      : undefined;
  const fromEntry = readString(nestedEntry?.key);
  if (fromEntry.length > 0) return fromEntry;

  throw new Error('sessions.create result did not contain a session key');
}

export async function listProjects(req: RequestFn): Promise<Project[]> {
  const result: unknown = await req('sessions.groups.list', {});
  if (!result || typeof result !== 'object') return [];

  const record = result as Record<string, unknown>;
  const groups = Array.isArray(record.groups) ? record.groups : [];

  const projects: Project[] = groups
    .filter((g: unknown) => {
      if (!g || typeof g !== 'object') return false;
      const gr = g as Record<string, unknown>;
      return (
        typeof gr.name === 'string' && typeof gr.position === 'number'
      );
    })
    .map((g: unknown) => {
      const gr = g as Record<string, unknown>;
      return {
        name: gr.name as string,
        position: gr.position as number,
      };
    });

  projects.sort((a, b) => a.position - b.position);
  return projects;
}

/** Chats of one agent, or of all agents when `agentId` is left out (the gateway then lists every agent's sessions). */
export async function listThreads(
  req: RequestFn,
  opts: { agentId?: string; limit?: number },
): Promise<Thread[]> {
  const agentId = opts.agentId;
  const limit = opts.limit ?? DEFAULT_THREAD_LIMIT;
  const threads: Thread[] = [];
  let offset: number | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const params: Record<string, unknown> = agentId === undefined ? { limit } : { agentId, limit };
    if (offset !== undefined) params.offset = offset;

    const result: unknown = await req('sessions.list', params);
    if (!result || typeof result !== 'object') break;
    const record = result as Record<string, unknown>;
    const rows = Array.isArray(record.sessions) ? record.sessions : [];

    for (const row of rows) {
      const thread = mapSessionRow(row, agentId);
      if (thread) threads.push(thread);
    }

    if (record.hasMore !== true) break;

    const nextOffset = record.nextOffset;
    if (typeof nextOffset === 'number') {
      offset = nextOffset;
    } else if (typeof nextOffset === 'string') {
      const parsed = parseInt(nextOffset, 10);
      offset = Number.isFinite(parsed) ? parsed : undefined;
    } else {
      break;
    }

    if (offset === undefined) break;
    pages += 1;
  }

  threads.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return threads;
}

export async function createThread(
  req: RequestFn,
  opts: { agentId: string; title?: string; project?: string | null },
): Promise<Thread> {
  const { agentId, project } = opts;
  const title = (opts.title ?? '').trim();

  const params: Record<string, unknown> = { agentId };
  if (title.length > 0) {
    params.label = title;
    params.displayName = title;
  }
  if (project !== undefined && project !== null) {
    params.category = project;
  }

  try {
    const result: unknown = await req('sessions.create', params);
    const key = createdSessionKey(result);

    const describe: unknown = await req('sessions.list', {
      agentId,
      search: key,
      limit: 10,
    });
    const describeRecord =
      describe && typeof describe === 'object'
        ? (describe as Record<string, unknown>)
        : undefined;
    const rows = Array.isArray(describeRecord?.sessions)
      ? describeRecord.sessions
      : [];
    const matched = rows.find((r: unknown) => {
      if (!r || typeof r !== 'object') return false;
      return (r as Record<string, unknown>).key === key;
    });
    const row = matched ?? result;
    const thread = mapSessionRow(row, agentId);
    if (thread) return thread;

    return {
      key,
      agentId,
      title: title || DEFAULT_THREAD_TITLE,
      project: project ?? null,
      updatedAt: Date.now(),
      pinned: false,
      hasActiveRun: false,
      unread: false,
      sessionId: undefined,
      model: null,
      effort: null,
    };
  } catch (error) {
    if (title.length > 0 && isLabelInUseError(error)) {
      return createThread(req, {
        agentId,
        title: `${title} (2)`,
        project: project ?? null,
      });
    }
    throw error;
  }
}

function clampTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('Title is required');
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return trimmed.slice(0, MAX_TITLE_LENGTH);
  }
  return trimmed;
}

export async function renameThread(
  req: RequestFn,
  key: string,
  title: string,
): Promise<void> {
  const originalTitle = clampTitle(title);
  let attempt = 0;

  while (true) {
    const label =
      attempt === 0 ? originalTitle : `${originalTitle} (${attempt + 1})`;
    try {
      await req('sessions.patch', { key, label });
      return;
    } catch (error) {
      if (!isLabelInUseError(error) || attempt >= 5) {
        throw error;
      }
      attempt += 1;
    }
  }
}

export async function moveThread(
  req: RequestFn,
  key: string,
  project: string | null,
): Promise<void> {
  await req('sessions.patch', { key, category: project });
}

export async function pinThread(
  req: RequestFn,
  key: string,
  pinned: boolean,
): Promise<void> {
  await req('sessions.patch', { key, pinned });
}

export async function archiveThread(
  req: RequestFn,
  thread: Pick<Thread, 'key' | 'sessionId' | 'agentId'>,
): Promise<void> {
  let sessionId = thread.sessionId;

  if (!sessionId) {
    const result: unknown = await req('sessions.list', {
      agentId: thread.agentId,
      search: thread.key,
      limit: 10,
    });
    const record =
      result && typeof result === 'object'
        ? (result as Record<string, unknown>)
        : undefined;
    const rows = Array.isArray(record?.sessions) ? record.sessions : [];
    const matched = rows.find((r: unknown) => {
      if (!r || typeof r !== 'object') return false;
      return (r as Record<string, unknown>).key === thread.key;
    });
    sessionId = readOptionalString(
      matched && typeof matched === 'object'
        ? (matched as Record<string, unknown>).sessionId
        : undefined,
    );
  }

  const params: Record<string, unknown> = { key: thread.key, archived: true };
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    params.expectedSessionId = sessionId;
  }

  await req('sessions.patch', params);
}

export async function createProject(
  req: RequestFn,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_LENGTH) {
    throw new Error(
      `Project name must be between 1 and ${MAX_PROJECT_LENGTH} characters`,
    );
  }

  const existing = await listProjects(req);
  const lower = trimmed.toLowerCase();
  if (existing.some((p) => p.name.toLowerCase() === lower)) {
    throw new Error('Project already exists');
  }

  const names = existing.map((p) => p.name);
  names.push(trimmed);
  await req('sessions.groups.put', { names });
}

export async function renameProject(
  req: RequestFn,
  name: string,
  to: string,
): Promise<void> {
  await req('sessions.groups.rename', { name, to });
}

export async function deleteProject(
  req: RequestFn,
  name: string,
): Promise<void> {
  await req('sessions.groups.delete', { name });
}

export function groupThreads(
  projects: Project[],
  threads: Thread[],
): {
  projects: { name: string; position: number; threads: Thread[] }[];
  loose: Thread[];
} {
  const catalogByName: Record<string, Project> = {};
  const grouped: { name: string; position: number; threads: Thread[] }[] = [];

  for (const project of projects) {
    catalogByName[project.name.toLowerCase()] = project;
    grouped.push({
      name: project.name,
      position: project.position,
      threads: [],
    });
  }

  const implicitIndexByName: Record<string, number> = {};
  const loose: Thread[] = [];

  for (const thread of threads) {
    if (thread.project === null) {
      loose.push(thread);
      continue;
    }

    const lower = thread.project.toLowerCase();
    const catalogProject = catalogByName[lower];
    if (catalogProject) {
      const section = grouped.find((g) => g.name === catalogProject.name);
      section?.threads.push(thread);
      continue;
    }

    let index = implicitIndexByName[lower];
    if (index === undefined) {
      index = grouped.length;
      implicitIndexByName[lower] = index;
      grouped.push({
        name: thread.project,
        position: 0,
        threads: [],
      });
    }
    grouped[index].threads.push(thread);
  }

  return { projects: grouped, loose };
}
