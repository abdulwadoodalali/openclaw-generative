// Threads and projects state, on top of the OpenClaw sessions API (src/openclaw/sessionsApi.ts).
// A thread is a gateway session, a project is the session category. Chats of ALL agents are listed
// (each thread knows its agent); a new chat is created under the default agent and gets the default
// model and effort. Plain observable store, no React, so it is easy to read: React wires it up
// through useSyncExternalStore in AnoProvider.
import {
  DEFAULT_THREAD_TITLE,
  archiveThread,
  createProject,
  createThread,
  deleteProject,
  groupThreads,
  listProjects,
  listThreads,
  moveThread,
  pinThread,
  renameProject,
  renameThread,
  type Project,
  type RequestFn,
  type Thread,
} from '../openclaw/sessionsApi';
import { parseChatPrefs, type ChatPrefs } from '../chat/prefs';
import { searchThreads } from '../chat/search';
import { applySessionPrefs, patchSessionEffort, patchSessionModel } from '../chat/sessionPrefs';
import type { Effort } from '../chat/effort';
import { kvDelete, kvGet, kvSet } from '../storage';

export type ThreadsState = {
  projects: Project[];
  /** App chats of every agent, pinned first, then newest first. */
  threads: Thread[];
  /** The open thread, or null for a draft (the session is created on the first message). */
  activeKey: string | null;
  /** Project a draft thread will be created in. */
  draftProject: string | null;
  /** What a new chat starts with. `agentId` is also the agent of the open draft. */
  defaults: ChatPrefs;
  loaded: boolean;
  loading: boolean;
  error?: string;
};

const ACTIVE_KEY = 'ano.activeThread';
const DEFAULTS_KEY = 'ano.chatDefaults';

/** The project the canvas runners keep their sessions in (src/canvas/runner.ts). Those are not chats. */
const CANVAS_PROJECT = 'Canvases';

type SessionPrefs = { model: string | null; effort: string | null };

export class ThreadsStore {
  private state: ThreadsState;
  /** Model and effort this app set per session, for rows the gateway lists without them. */
  private readonly localPrefs = new Map<string, Partial<SessionPrefs>>();
  private readonly listeners = new Set<() => void>();
  private readonly req: RequestFn;

  /** `agentId` is the default agent until the stored defaults are loaded (loadDefaults). */
  constructor(req: RequestFn, agentId: string) {
    this.req = req;
    this.state = {
      projects: [],
      threads: [],
      activeKey: null,
      draftProject: null,
      defaults: { agentId, model: null, effort: null },
      loaded: false,
      loading: false,
    };
  }

  getState = (): ThreadsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<ThreadsState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Reads the persisted defaults (once at startup). `fallbackAgentId` is used until one was chosen. */
  async loadDefaults(fallbackAgentId: string): Promise<void> {
    const raw = await kvGet(DEFAULTS_KEY);
    this.set({ defaults: parseChatPrefs(raw, fallbackAgentId) });
  }

  /** Changes what new chats start with, and keeps it. */
  setDefaults(patch: Partial<ChatPrefs>): void {
    const defaults = { ...this.state.defaults, ...patch };
    this.set({ defaults });
    void kvSet(DEFAULTS_KEY, JSON.stringify(defaults));
  }

  /** The persisted open thread (read once at startup). */
  async restoreActiveKey(): Promise<string | null> {
    const key = await kvGet(ACTIVE_KEY);
    return key || null;
  }

  setActive(key: string | null, draftProject: string | null = null): void {
    this.set({ activeKey: key, draftProject: key ? null : draftProject });
    if (key) void kvSet(ACTIVE_KEY, key);
    else void kvDelete(ACTIVE_KEY);
  }

  activeThread(): Thread | undefined {
    const key = this.state.activeKey;
    return key ? this.state.threads.find((t) => t.key === key) : undefined;
  }

  /** Model and effort of a chat: the gateway row when listed, else what this app set. */
  prefsFor(key: string): SessionPrefs {
    const thread = this.state.threads.find((t) => t.key === key);
    if (thread) return { model: thread.model, effort: thread.effort };
    const local = this.localPrefs.get(key);
    return { model: local?.model ?? null, effort: local?.effort ?? null };
  }

  async refresh(): Promise<void> {
    this.set({ loading: true, error: undefined });
    try {
      const [projects, listed] = await Promise.all([listProjects(this.req), listThreads(this.req, {})]);
      const threads = listed
        .filter((t) => t.project !== CANVAS_PROJECT)
        .map((t) => {
          const local = this.localPrefs.get(t.key);
          return local ? { ...t, model: t.model ?? local.model ?? null, effort: t.effort ?? local.effort ?? null } : t;
        });
      this.set({ projects, threads, loaded: true, loading: false });
    } catch (e) {
      this.set({ loading: false, error: e instanceof Error ? e.message : 'Could not load threads' });
    }
  }

  grouped() {
    return groupThreads(this.state.projects, this.state.threads);
  }

  /** Chats whose title matches `query` (client side). An empty query returns all chats. */
  search(query: string): Thread[] {
    return searchThreads(this.state.threads, query);
  }

  /** Creates a session under the default agent, on the default model and effort, and opens it. */
  async create(project: string | null): Promise<Thread> {
    const { agentId, model, effort } = this.state.defaults;
    const created = await createThread(this.req, { agentId, project });
    const applied = await applySessionPrefs(this.req, created.key, { model, effort });
    this.localPrefs.set(created.key, applied);
    const thread: Thread = { ...created, model: applied.model, effort: applied.effort };
    this.set({ threads: [thread, ...this.state.threads] });
    this.setActive(thread.key);
    return thread;
  }

  /** Puts a chat on `model` ("<provider>/<id>"), or back on its agent's default (null). */
  async setThreadModel(key: string, model: string | null): Promise<void> {
    await patchSessionModel(this.req, key, model);
    this.localPrefs.set(key, { ...this.localPrefs.get(key), model });
    this.patchThread(key, { model });
  }

  /** Sets a chat's thinking effort, or back to its agent's default (null). */
  async setThreadEffort(key: string, effort: Effort | null): Promise<void> {
    await patchSessionEffort(this.req, key, effort);
    this.localPrefs.set(key, { ...this.localPrefs.get(key), effort });
    this.patchThread(key, { effort });
  }

  /** Give a fresh thread a readable title from its first message (the gateway label is unique). */
  async autoTitle(key: string, firstMessage: string): Promise<void> {
    const thread = this.state.threads.find((t) => t.key === key);
    if (!thread || thread.title !== DEFAULT_THREAD_TITLE) return;
    const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!title) return;
    try {
      await renameThread(this.req, key, title);
      this.patchThread(key, { title });
    } catch {
      // Titles are cosmetic. Leave the default.
    }
  }

  private patchThread(key: string, patch: Partial<Thread>): void {
    this.set({ threads: this.state.threads.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  }

  async rename(key: string, title: string): Promise<void> {
    await renameThread(this.req, key, title);
    await this.refresh();
  }

  async move(key: string, project: string | null): Promise<void> {
    await moveThread(this.req, key, project);
    this.patchThread(key, { project });
  }

  async pin(key: string, pinned: boolean): Promise<void> {
    await pinThread(this.req, key, pinned);
    await this.refresh();
  }

  /** "Delete" is archive: sessions.delete needs the admin scope the app does not have. */
  async archive(thread: Thread): Promise<void> {
    await archiveThread(this.req, thread);
    this.localPrefs.delete(thread.key);
    this.set({ threads: this.state.threads.filter((t) => t.key !== thread.key) });
    if (this.state.activeKey === thread.key) this.setActive(null);
  }

  async createProject(name: string): Promise<void> {
    await createProject(this.req, name);
    await this.refresh();
  }

  async renameProject(name: string, to: string): Promise<void> {
    await renameProject(this.req, name, to.trim());
    await this.refresh();
  }

  /** Deleting a project keeps its threads: they become loose threads. */
  async deleteProject(name: string): Promise<void> {
    await deleteProject(this.req, name);
    await this.refresh();
  }
}
