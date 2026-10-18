// @ts-nocheck
// Tests run under Node 26 with --experimental-strip-types; no @types/node in this Expo project.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  mapSessionRow,
  listThreads,
  agentIdOfKey,
  createThread,
  renameThread,
  moveThread,
  archiveThread,
  createProject,
  groupThreads,
  DEFAULT_THREAD_TITLE,
  type RequestFn,
  type Thread,
  type Project,
} from './sessionsApi.ts';

type SessionRow = {
  key: string;
  agentId: string;
  label?: string;
  displayName?: string;
  category?: string | null;
  pinned?: boolean;
  archived?: boolean;
  updatedAt?: number;
  lastActivityAt?: number;
  unread?: boolean;
  hasActiveRun?: boolean;
  sessionId?: string;
  kind?: string;
};

type PendingError = {
  method: string;
  match?: (params: Record<string, unknown>) => boolean;
  error: Error;
};

class FakeGateway {
  sessions: SessionRow[] = [];
  groups: Project[] = [];
  calls: { method: string; params: Record<string, unknown> }[] = [];
  pendingErrors: PendingError[] = [];

  request: RequestFn = async (method, params = {}) => {
    this.calls.push({ method, params });

    const pendingIndex = this.pendingErrors.findIndex(
      (pe) =>
        pe.method === method &&
        (!pe.match || pe.match(params as Record<string, unknown>)),
    );
    if (pendingIndex !== -1) {
      const [pe] = this.pendingErrors.splice(pendingIndex, 1);
      throw pe.error;
    }

    switch (method) {
      case 'sessions.list':
        return this.list(params as Record<string, unknown>);
      case 'sessions.create':
        return this.create(params as Record<string, unknown>);
      case 'sessions.patch':
        return this.patch(params as Record<string, unknown>);
      case 'sessions.groups.list':
        return { groups: this.groups };
      case 'sessions.groups.put':
        return this.putGroups(params as Record<string, unknown>);
      case 'sessions.groups.rename':
        return this.renameGroup(params as Record<string, unknown>);
      case 'sessions.groups.delete':
        return this.deleteGroup(params as Record<string, unknown>);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  };

  private list(params: Record<string, unknown>) {
    const agentId = params.agentId;
    const search = params.search;
    const limit = typeof params.limit === 'number' ? params.limit : 50;
    const offset =
      typeof params.offset === 'number'
        ? params.offset
        : typeof params.offset === 'string'
          ? parseInt(params.offset, 10)
          : 0;

    let rows = this.sessions.filter((s) => s.archived !== true);

    if (typeof agentId === 'string') {
      rows = rows.filter((s) => s.key.startsWith(`agent:${agentId}:`));
    }
    if (typeof search === 'string') {
      rows = rows.filter((s) => s.key.includes(search));
    }

    const total = rows.length;
    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < total;

    return {
      sessions: page,
      hasMore,
      nextOffset: hasMore ? nextOffset : undefined,
      totalCount: total,
    };
  }

  private create(params: Record<string, unknown>) {
    const agentId = readString(params.agentId);
    const label = readOptionalString(params.label);
    const category = readOptionalString(params.category);

    if (label && this.sessions.some((s) => s.label === label)) {
      throw new Error('label already in use');
    }

    const key = `agent:${agentId}:dashboard:${crypto.randomUUID()}`;
    const row: SessionRow = {
      key,
      agentId,
      label,
      displayName: label,
      category: category ?? null,
      pinned: false,
      archived: false,
      updatedAt: Date.now(),
      unread: false,
      hasActiveRun: false,
      sessionId: crypto.randomUUID(),
    };
    this.sessions.push(row);
    return { key, session: row };
  }

  private patch(params: Record<string, unknown>) {
    const key = readString(params.key);
    const row = this.sessions.find((s) => s.key === key);
    if (!row) throw new Error('session not found');

    if ('label' in params) {
      const label = readString(params.label);
      if (
        label.length > 0 &&
        this.sessions.some((s) => s.key !== key && s.label === label)
      ) {
        throw new Error('label already in use');
      }
      row.label = label;
      row.displayName = label;
    }
    if ('category' in params) {
      row.category =
        params.category === null ? null : readString(params.category);
    }
    if ('pinned' in params) row.pinned = params.pinned === true;
    if ('archived' in params) row.archived = params.archived === true;

    return { ok: true };
  }

  private putGroups(params: Record<string, unknown>) {
    const names = Array.isArray(params.names)
      ? params.names.filter((n): n is string => typeof n === 'string')
      : [];

    const positionByName: Record<string, number> = {};
    let maxPosition = 0;
    for (const g of this.groups) {
      positionByName[g.name] = g.position;
      if (g.position > maxPosition) maxPosition = g.position;
    }

    this.groups = names.map((name, index) => ({
      name,
      position: positionByName[name] ?? maxPosition + index + 1,
    }));
    return { groups: this.groups };
  }

  private renameGroup(params: Record<string, unknown>) {
    const name = readString(params.name);
    const to = readString(params.to);
    const group = this.groups.find((g) => g.name === name);
    if (group) group.name = to;
    for (const s of this.sessions) {
      if (s.category === name) s.category = to;
    }
    return { ok: true };
  }

  private deleteGroup(params: Record<string, unknown>) {
    const name = readString(params.name);
    this.groups = this.groups.filter((g) => g.name !== name);
    for (const s of this.sessions) {
      if (s.category === name) s.category = null;
    }
    return { ok: true };
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function makeRow(overrides: Partial<SessionRow> & { key: string; agentId: string }): SessionRow {
  return {
    pinned: false,
    archived: false,
    unread: false,
    hasActiveRun: false,
    updatedAt: 0,
    category: null,
    ...overrides,
  };
}

describe('mapSessionRow', () => {
  const agentId = 'main';

  it('keeps dashboard key direct threads', () => {
    const row = makeRow({
      key: `agent:${agentId}:dashboard:abc`,
      agentId,
      label: 'Budget review',
    });
    const thread = mapSessionRow(row, agentId);
    assert.ok(thread);
    assert.equal(thread.title, 'Budget review');
    assert.equal(thread.project, null);
  });

  it('keeps ios- and ios: keys', () => {
    const row1 = makeRow({
      key: `agent:${agentId}:ios-abc`,
      agentId,
      displayName: 'iOS dash',
    });
    const row2 = makeRow({
      key: `agent:${agentId}:ios:abc`,
      agentId,
      displayName: 'iOS colon',
    });
    assert.ok(mapSessionRow(row1, agentId));
    assert.ok(mapSessionRow(row2, agentId));
  });

  it('keeps rows with a non-empty category', () => {
    const row = makeRow({
      key: `agent:${agentId}:some-thread`,
      agentId,
      category: 'Household',
    });
    assert.ok(mapSessionRow(row, agentId));
    assert.equal(mapSessionRow(row, agentId)?.project, 'Household');
  });

  it('drops main, telegram, cron, subagent, and group keys', () => {
    assert.equal(
      mapSessionRow(
        makeRow({ key: `agent:${agentId}:main`, agentId }),
        agentId,
      ),
      null,
    );
    assert.equal(
      mapSessionRow(
        makeRow({ key: `agent:${agentId}:telegram:group:1`, agentId }),
        agentId,
      ),
      null,
    );
    assert.equal(
      mapSessionRow(
        makeRow({ key: `agent:${agentId}:cron:x`, agentId }),
        agentId,
      ),
      null,
    );
    assert.equal(
      mapSessionRow(
        makeRow({ key: `agent:${agentId}:subagent:x`, agentId }),
        agentId,
      ),
      null,
    );
    assert.equal(
      mapSessionRow(
        makeRow({ key: `agent:${agentId}:group:x`, agentId }),
        agentId,
      ),
      null,
    );
  });

  it('drops non-direct kinds and archived rows', () => {
    assert.equal(
      mapSessionRow(
        makeRow({
          key: `agent:${agentId}:dashboard:x`,
          agentId,
          kind: 'cron',
        }),
        agentId,
      ),
      null,
    );
    assert.equal(
      mapSessionRow(
        makeRow({
          key: `agent:${agentId}:dashboard:x`,
          agentId,
          archived: true,
        }),
        agentId,
      ),
      null,
    );
  });

  it('falls back to the default title for uuid labels and key-equals-label', () => {
    const uuid = crypto.randomUUID();
    const row1 = makeRow({
      key: `agent:${agentId}:dashboard:x`,
      agentId,
      label: uuid,
      displayName: 'Ignored',
    });
    const row2 = makeRow({
      key: `agent:${agentId}:dashboard:y`,
      agentId,
      label: `agent:${agentId}:dashboard:y`,
    });
    assert.equal(mapSessionRow(row1, agentId)?.title, DEFAULT_THREAD_TITLE);
    assert.equal(mapSessionRow(row2, agentId)?.title, DEFAULT_THREAD_TITLE);
  });

  it('prefers lastActivityAt over updatedAt', () => {
    const row = makeRow({
      key: `agent:${agentId}:dashboard:z`,
      agentId,
      updatedAt: 100,
      lastActivityAt: 200,
    });
    assert.equal(mapSessionRow(row, agentId)?.updatedAt, 200);
  });
});

describe('listThreads', () => {
  it('filters, pages, and sorts pinned first then updatedAt desc', async () => {
    const gateway = new FakeGateway();
    const agentId = 'main';

    for (let i = 0; i < 6; i += 1) {
      gateway.sessions.push(
        makeRow({
          key: `agent:${agentId}:dashboard:${i}`,
          agentId,
          label: `Thread ${i}`,
          pinned: i === 1,
          updatedAt: 1000 + i,
        }),
      );
    }
    gateway.sessions.push(
      makeRow({
        key: `agent:${agentId}:telegram:group:1`,
        agentId,
        label: 'Telegram',
      }),
    );

    const threads = await listThreads(gateway.request, { agentId, limit: 3 });
    assert.equal(threads.length, 6);
    assert.equal(threads[0].title, 'Thread 1'); // pinned
    assert.equal(threads[1].title, 'Thread 5'); // highest updatedAt
    assert.equal(threads[5].title, 'Thread 0'); // lowest updatedAt

    const listCalls = gateway.calls.filter((c) => c.method === 'sessions.list');
    assert.ok(listCalls.length > 1, 'should have paginated');
  });

  it('without an agentId lists the app chats of every agent and drops main, channel and cron sessions', async () => {
    const gateway = new FakeGateway();
    gateway.sessions.push(
      makeRow({ key: 'agent:main:dashboard:a', agentId: 'main', label: 'General chat', updatedAt: 10 }),
      makeRow({ key: 'agent:finance:ios-1', agentId: 'finance', label: 'Budget', updatedAt: 30 }),
      makeRow({
        key: 'agent:household:dashboard:h',
        agentId: 'household',
        label: 'Chores',
        updatedAt: 20,
        providerOverride: 'openrouter',
        modelOverride: 'google/gemini-3.8-flash',
        thinkingLevel: 'low',
      }),
      makeRow({ key: 'agent:main:main', agentId: 'main', label: 'Main' }),
      makeRow({ key: 'agent:main:telegram:direct:1', agentId: 'main', label: 'Telegram' }),
      makeRow({ key: 'agent:notes:cron:nightly', agentId: 'notes', label: 'Cron' }),
      makeRow({ key: 'agent:finance:whatsapp:group:1', agentId: 'finance', label: 'WhatsApp' }),
    );

    const threads = await listThreads(gateway.request, {});
    assert.deepEqual(
      threads.map((t) => [t.title, t.agentId]),
      [
        ['Budget', 'finance'],
        ['Chores', 'household'],
        ['General chat', 'main'],
      ],
    );
    const listCall = gateway.calls.find((c) => c.method === 'sessions.list');
    assert.equal('agentId' in listCall.params, false);

    const chores = threads[1];
    assert.equal(chores.model, 'openrouter/google/gemini-3.8-flash');
    assert.equal(chores.effort, 'low');
    assert.equal(threads[0].model, null);
    assert.equal(threads[0].effort, null);
  });

  it('agentIdOfKey reads the agent from a session key', () => {
    assert.equal(agentIdOfKey('agent:finance:dashboard:x'), 'finance');
    assert.equal(agentIdOfKey('not-a-session-key'), null);
  });
});

describe('createThread', () => {
  it('creates a thread without a key and applies project/category', async () => {
    const gateway = new FakeGateway();
    const agentId = 'main';

    const thread = await createThread(gateway.request, {
      agentId,
      title: 'Trip planning',
      project: 'Travel',
    });

    assert.equal(thread.agentId, agentId);
    assert.equal(thread.title, 'Trip planning');
    assert.equal(thread.project, 'Travel');
    assert.ok(thread.key.includes(':dashboard:'));

    const createCall = gateway.calls.find((c) => c.method === 'sessions.create');
    assert.ok(createCall);
    assert.equal(createCall?.params.agentId, agentId);
    assert.equal(createCall?.params.label, 'Trip planning');
    assert.equal(createCall?.params.displayName, 'Trip planning');
    assert.equal(createCall?.params.category, 'Travel');
    assert.equal('key' in createCall!.params, false);
  });

  it('retries once on label collision', async () => {
    const gateway = new FakeGateway();
    const agentId = 'main';

    gateway.sessions.push(
      makeRow({
        key: `agent:${agentId}:dashboard:existing`,
        agentId,
        label: 'Existing',
      }),
    );

    // First create fails, second succeeds.
    gateway.pendingErrors.push({
      method: 'sessions.create',
      match: (p) => p.label === 'Existing',
      error: new Error('label already in use'),
    });

    const thread = await createThread(gateway.request, {
      agentId,
      title: 'Existing',
    });

    assert.equal(thread.title, 'Existing (2)');
    const createCalls = gateway.calls.filter(
      (c) => c.method === 'sessions.create',
    );
    assert.equal(createCalls.length, 2);
    assert.equal(createCalls[1].params.label, 'Existing (2)');
  });
});

describe('renameThread', () => {
  it('renames and retries through suffixes on collision', async () => {
    const gateway = new FakeGateway();
    const agentId = 'main';

    gateway.sessions.push(
      makeRow({
        key: `agent:${agentId}:dashboard:a`,
        agentId,
        label: 'Old',
      }),
      makeRow({
        key: `agent:${agentId}:dashboard:b`,
        agentId,
        label: 'Taken',
      }),
      makeRow({
        key: `agent:${agentId}:dashboard:c`,
        agentId,
        label: 'Taken (2)',
      }),
    );

    await renameThread(gateway.request, `agent:${agentId}:dashboard:a`, 'Taken');

    const patchCalls = gateway.calls.filter((c) => c.method === 'sessions.patch');
    assert.equal(patchCalls.length, 3);
    assert.equal(patchCalls[0].params.label, 'Taken');
    assert.equal(patchCalls[1].params.label, 'Taken (2)');
    assert.equal(patchCalls[2].params.label, 'Taken (3)');

    const row = gateway.sessions.find(
      (s) => s.key === `agent:${agentId}:dashboard:a`,
    );
    assert.equal(row?.label, 'Taken (3)');
  });

  it('rejects empty titles', async () => {
    const gateway = new FakeGateway();
    await assert.rejects(
      renameThread(gateway.request, 'agent:main:dashboard:x', '   '),
      /Title is required/,
    );
  });
});

describe('moveThread', () => {
  it('patches category to move a thread', async () => {
    const gateway = new FakeGateway();
    const key = 'agent:main:dashboard:move';
    gateway.sessions.push(makeRow({ key, agentId: 'main' }));

    await moveThread(gateway.request, key, 'Work');

    const call = gateway.calls.find((c) => c.method === 'sessions.patch');
    assert.ok(call);
    assert.equal(call?.params.key, key);
    assert.equal(call?.params.category, 'Work');
  });
});

describe('archiveThread', () => {
  it('archives with provided sessionId', async () => {
    const gateway = new FakeGateway();
    const key = 'agent:main:dashboard:arch';
    gateway.sessions.push(
      makeRow({ key, agentId: 'main', sessionId: 'sid-123' }),
    );

    await archiveThread(gateway.request, {
      key,
      agentId: 'main',
      sessionId: 'sid-123',
    });

    const call = gateway.calls.find((c) => c.method === 'sessions.patch');
    assert.equal(call?.params.archived, true);
    assert.equal(call?.params.expectedSessionId, 'sid-123');
  });

  it('looks up sessionId when missing', async () => {
    const gateway = new FakeGateway();
    const key = 'agent:main:dashboard:arch2';
    gateway.sessions.push(
      makeRow({
        key,
        agentId: 'main',
        sessionId: 'sid-lookup',
      }),
    );

    await archiveThread(gateway.request, {
      key,
      agentId: 'main',
    });

    const listCall = gateway.calls.find((c) => c.method === 'sessions.list');
    assert.ok(listCall);
    assert.equal(listCall?.params.search, key);

    const patchCall = gateway.calls.find((c) => c.method === 'sessions.patch');
    assert.equal(patchCall?.params.expectedSessionId, 'sid-lookup');
  });
});

describe('createProject', () => {
  it('appends a new project and rejects duplicates case-insensitively', async () => {
    const gateway = new FakeGateway();
    gateway.groups.push({ name: 'Household', position: 1 });

    await createProject(gateway.request, 'Work');
    assert.equal(gateway.groups.length, 2);
    assert.ok(gateway.groups.some((g) => g.name === 'Work'));

    await assert.rejects(
      createProject(gateway.request, 'work'),
      /Project already exists/,
    );
    await assert.rejects(
      createProject(gateway.request, ''),
      /Project name must be/,
    );
  });
});

describe('groupThreads', () => {
  it('groups by catalog projects and appends implicit sections', () => {
    const projects: Project[] = [
      { name: 'Work', position: 1 },
      { name: 'Personal', position: 2 },
    ];

    const threads: Thread[] = [
      { key: 'a', agentId: 'x', title: 'w1', project: 'Work', updatedAt: 1, pinned: false, hasActiveRun: false, unread: false },
      { key: 'b', agentId: 'x', title: 'p1', project: 'Personal', updatedAt: 2, pinned: false, hasActiveRun: false, unread: false },
      { key: 'c', agentId: 'x', title: 'old', project: 'Legacy', updatedAt: 3, pinned: false, hasActiveRun: false, unread: false },
      { key: 'd', agentId: 'x', title: 'loose', project: null, updatedAt: 4, pinned: false, hasActiveRun: false, unread: false },
    ];

    const grouped = groupThreads(projects, threads);

    assert.equal(grouped.projects.length, 3);
    assert.equal(grouped.projects[0].name, 'Work');
    assert.equal(grouped.projects[0].threads.length, 1);
    assert.equal(grouped.projects[1].name, 'Personal');
    assert.equal(grouped.projects[1].threads.length, 1);
    assert.equal(grouped.projects[2].name, 'Legacy');
    assert.equal(grouped.projects[2].threads.length, 1);
    assert.equal(grouped.loose.length, 1);
    assert.equal(grouped.loose[0].title, 'loose');
  });
});
