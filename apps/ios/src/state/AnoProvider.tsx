// App wiring: settings, the gateway connection, the AG-UI agent (OpenClawAgent behind CopilotKit's
// headless provider) and the threads store. Screens read everything through useAno().
//
//   settings -> GatewayConnection (official gateway client) -> OpenClawAgent (AbstractAgent)
//                                                         \-> ThreadsStore (sessions.* API)
//   CopilotKitProvider (headless, no runtime URL) hosts the agent so build 2 can use
//   useRenderToolCall / useFrontendTool / useComponent against it.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { CopilotKitProvider, useAgent, useCopilotKit, UseAgentUpdate } from '@copilotkit/react-native/headless';
import {
  DEFAULT_SETTINGS,
  clearDeviceToken,
  loadDeviceToken,
  loadSecrets,
  loadSettings,
  saveGatewayToken,
  saveSettings,
  type Settings,
} from '../config';
import { agentLabel as readableAgentName } from '../home/cards';
import type { ConnectionInfo, GatewayConnection } from '../openclaw/gatewayConnection';
import { OpenClawAgent, type AnswerProcess, type RunActivity } from '../openclaw/OpenClawAgent';
import { resetDeviceIdentity } from '../openclaw/deviceIdentity';
import { DEFAULT_THREAD_TITLE, agentIdOfKey } from '../openclaw/sessionsApi';
import { decideStartup, isRepairCode, repairNeedsFreshIdentity } from '../connectPolicy';
import { orbSignal } from '../orb/orbStore';
import { runAutoPair } from './pairing';
import { createAppGateway } from './gateway';
import { ThreadsStore, type ThreadsState } from './threadsStore';
import { catalogSeenReady, getAnoAgentHooks } from './agentHooks';
import { startCanvasRunners } from '../canvas/instance';
import { asEffort, type Effort } from '../chat/effort';
import { ImageStore } from '../chat/images';
import type { ChatPrefs } from '../chat/prefs';
import { SendQueue, type QueuedTurn } from '../chat/queue';
import { imageOnlyPrompt, planRetry, startTurn, steerTurn, withBrain } from '../chat/turn';
import type { PickedImage } from '../chat/types';

export type { AnswerProcess, PickedImage, QueuedTurn };

export const ANO_AGENT_ID = 'ano';

export type PairingState = { phase: 'idle' | 'running' | 'failed'; message?: string };

/** A rate-limited pairing is retried once by itself if the wait is this short or shorter. */
const AUTO_RETRY_MAX_MS = 120_000;

type AnoContextValue = {
  gateway: GatewayConnection;
  settings: Settings;
  /** False until the stored settings were read. */
  settingsLoaded: boolean;
  paired: boolean;
  /** True when automatic pairing failed (or was reset without a way to retry): the UI opens the manual setup sheet. */
  needsSetup: boolean;
  /** Automatic discovery + pairing state. `running` shows "Connecting to Ano..." with no sheet. */
  pairing: PairingState;
  /** Run discovery and pairing now (Settings "Try again"). Resolves true once connected credentials were stored. */
  pairAutomatically: () => Promise<boolean>;
  connection: ConnectionInfo;
  saveSettingsAndConnect: (settings: Settings, gatewayToken: string | undefined) => Promise<void>;
  reconnect: () => void;
  resetPairing: () => Promise<void>;
  threadsStore: ThreadsStore;
  threads: ThreadsState;
  /** Run an action and surface a failure in `notice`. */
  agentLabel: string;
};

const AnoContext = createContext<AnoContextValue | null>(null);

export function useAno(): AnoContextValue {
  const ctx = useContext(AnoContext);
  if (!ctx) throw new Error('useAno must be used inside <AnoProvider>');
  return ctx;
}

/** Outer provider: owns the singletons, loads settings and drives the connection. */
export function AnoProvider({ children }: { children: React.ReactNode }) {
  const gatewayRef = useRef<GatewayConnection | null>(null);
  if (!gatewayRef.current) gatewayRef.current = createAppGateway();
  const gateway = gatewayRef.current;

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [paired, setPaired] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pairing, setPairing] = useState<PairingState>({ phase: 'idle' });
  const pairRunning = useRef(false);
  const rateRetried = useRef(false);
  const rateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repairBudget = useRef(1);

  const threadsStoreRef = useRef<ThreadsStore | null>(null);
  if (!threadsStoreRef.current) {
    threadsStoreRef.current = new ThreadsStore((m, p) => gateway.request(m, p), DEFAULT_SETTINGS.agentId);
  }
  const threadsStore = threadsStoreRef.current;

  // The canvas runners live outside React; they read the default agent through a ref.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const canvasRunnersStarted = useRef(false);
  if (!canvasRunnersStarted.current) {
    canvasRunnersStarted.current = true;
    startCanvasRunners({ gateway, getDefaultAgentId: () => settingsRef.current.agentId, createId: randomUUID });
  }

  const connection = useSyncExternalStore(gateway.subscribeStatus, gateway.getInfo, gateway.getInfo);
  const threads = useSyncExternalStore(threadsStore.subscribe, threadsStore.getState, threadsStore.getState);

  // The orb goes grey while the gateway is not ready.
  const online = connection.status === 'ready';
  useEffect(() => orbSignal({ type: 'connection', online }), [online]);

  const connect = useCallback(
    async (s: Settings) => {
      const secrets = await loadSecrets();
      gateway.start({ url: s.url, gatewayToken: secrets.gatewayToken });
    },
    [gateway],
  );

  // Discover the ano-pair service, pair, then connect as operator. Single flight; one attempt per call.
  const pairAndConnect = useCallback(async (): Promise<boolean> => {
    if (pairRunning.current) return false;
    pairRunning.current = true;
    setPairing({ phase: 'running' });
    try {
      const result = await runAutoPair();
      if (!result.ok) {
        setPairing({ phase: 'failed', message: result.message });
        setNeedsSetup(true);
        // Honor Retry-After: one scheduled retry if the wait is short, otherwise leave it to the user.
        if (
          result.reason === 'rate-limited' &&
          !rateRetried.current &&
          typeof result.retryAfterMs === 'number' &&
          result.retryAfterMs <= AUTO_RETRY_MAX_MS
        ) {
          rateRetried.current = true;
          if (rateTimer.current) clearTimeout(rateTimer.current);
          rateTimer.current = setTimeout(() => {
            rateTimer.current = null;
            void pairAndConnect();
          }, result.retryAfterMs + 500);
        }
        return false;
      }
      setPairing({ phase: 'idle' });
      repairBudget.current = 0; // a fresh pairing that is rejected right away must not loop
      setPaired(true);
      setNeedsSetup(false);
      const s = await loadSettings();
      setSettings(s);
      await connect(s);
      return true;
    } catch {
      setPairing({ phase: 'failed', message: 'Pairing failed. You can connect by hand below.' });
      setNeedsSetup(true);
      return false;
    } finally {
      pairRunning.current = false;
    }
  }, [connect]);

  useEffect(
    () => () => {
      if (rateTimer.current) clearTimeout(rateTimer.current);
    },
    [],
  );

  // Startup: read settings, then connect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSettings();
      if (cancelled) return;
      await threadsStore.loadDefaults(s.agentId);
      setSettings(s);
      setSettingsLoaded(true);
      const deviceToken = await loadDeviceToken();
      const secrets = await loadSecrets();
      if (cancelled) return;
      setPaired(!!deviceToken);
      // A stored device token (or a hand-pasted gateway token) means connect now, no Settings.
      // Nothing stored: find the ano-pair service and pair by itself. The sheet only opens if that fails.
      const decision = decideStartup({ hasDeviceToken: !!deviceToken, hasGatewayToken: !!secrets.gatewayToken });
      if (decision === 'auto-pair') {
        setPairing({ phase: 'running' });
        await pairAndConnect();
        return;
      }
      await connect(s);
    })();
    return () => {
      cancelled = true;
      gateway.stop();
    };
  }, [connect, gateway, threadsStore, pairAndConnect]);

  // Back in the foreground: reconnect now. iOS froze the socket and the retry timer while away, so a
  // reply that landed meanwhile would otherwise wait for a backoff or the tick watchdog.
  useEffect(() => {
    let awaySince: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        awaySince ??= Date.now();
        return;
      }
      if (awaySince !== null) gateway.resume(Date.now() - awaySince);
      awaySince = null;
    });
    return () => sub.remove();
  }, [gateway]);

  // A stored device token the gateway rejected (revoked, device removed, scopes drifted): clear it and
  // pair again, once. If that connect fails the same way the error stays visible (PAIRING.md section 7).
  useEffect(() => {
    if (connection.status === 'ready') {
      repairBudget.current = 1;
      return;
    }
    if (
      connection.status === 'auth-failed' &&
      connection.failureUsedStoredToken &&
      isRepairCode(connection.failureCode) &&
      repairBudget.current > 0
    ) {
      repairBudget.current = 0;
      const freshIdentity = repairNeedsFreshIdentity(connection.failureCode);
      void (async () => {
        await clearDeviceToken();
        // The Mac forgot this device and now holds a pending request for the old id: use a new one.
        if (freshIdentity) await resetDeviceIdentity();
        setPaired(false);
        await pairAndConnect();
      })();
    }
  }, [connection.status, connection.failureCode, connection.failureUsedStoredToken, pairAndConnect]);

  // A successful connect stores a device token, a rejected one is cleared by the connection.
  useEffect(() => {
    if (connection.status === 'ready' || connection.status === 'auth-failed') {
      void loadDeviceToken().then((t) => setPaired(!!t));
    }
    // Setup is done once the gateway accepted us (the device token is stored by then).
    if (connection.status === 'ready') setNeedsSetup(false);
  }, [connection.status, connection.readyCount]);

  const saveSettingsAndConnect = useCallback(
    async (next: Settings, gatewayToken: string | undefined) => {
      if (gatewayToken) await saveGatewayToken(gatewayToken);
      await saveSettings(next);
      if (next.agentId !== settings.agentId) threadsStore.setDefaults({ agentId: next.agentId });
      setSettings(next);
      await connect(next);
    },
    [connect, settings.agentId, threadsStore],
  );

  const reconnect = useCallback(() => {
    void connect(settings);
  }, [connect, settings]);

  const resetPairing = useCallback(async () => {
    gateway.stop();
    await clearDeviceToken();
    await resetDeviceIdentity();
    setPaired(false);
    const secrets = await loadSecrets();
    if (decideStartup({ hasDeviceToken: false, hasGatewayToken: !!secrets.gatewayToken }) === 'auto-pair') {
      await pairAndConnect();
      return;
    }
    await connect(settings);
  }, [connect, gateway, settings, pairAndConnect]);

  const agentLabel = readableAgentName(settings.agentId);

  const value = useMemo<AnoContextValue>(
    () => ({
      gateway,
      settings,
      settingsLoaded,
      paired,
      needsSetup,
      pairing,
      pairAutomatically: pairAndConnect,
      connection,
      saveSettingsAndConnect,
      reconnect,
      resetPairing,
      threadsStore,
      threads,
      agentLabel,
    }),
    [gateway, settings, settingsLoaded, paired, needsSetup, pairing, pairAndConnect, connection, saveSettingsAndConnect, reconnect, resetPairing, threadsStore, threads, agentLabel],
  );

  return (
    <AnoContext.Provider value={value}>
      {/* Headless CopilotKit. No runtime URL: the only agent is the local OpenClawAgent below. */}
      <CopilotKitProvider runtimeUrl="" onError={() => undefined}>
        <AgentHost>{children}</AgentHost>
      </CopilotKitProvider>
    </AnoContext.Provider>
  );
}

// ---- agent host + chat controller -------------------------------------------------------------

export type ChatApi = {
  agent: OpenClawAgent;
  messages: ReturnType<typeof useAgent>['agent']['messages'];
  isRunning: boolean;
  /** What the current run is doing (thinking, a tool, a handoff, answering). Null before any run. */
  activity: RunActivity | null;
  error: string | null;
  clearError: () => void;
  /**
   * Send a message, optionally with images. A draft chat is created first, with the current agent, model and effort.
   * While a run streams the message is queued. `once` runs just this message on another model and effort: the chat
   * is patched before the send and put back (null = agent default) when the run ends, fails or is stopped. It does
   * not change `prefs` or the defaults, and a queued message keeps its own `once`.
   */
  send: (text: string, opts?: { images?: PickedImage[]; once?: { model: string | null; effort: Effort | null } }) => Promise<void>;
  /**
   * Send a `[ui-event]` text produced by a generated component. Idle: a normal run (no auto-title).
   * While a run is streaming: steers that run instead of starting a second one.
   */
  sendUiEvent: (text: string) => Promise<void>;
  stop: () => void;
  openThread: (key: string) => Promise<void>;
  newThread: (project?: string | null) => void;
  /** True while a thread's history is loading. */
  loadingHistory: boolean;
  /** Agent, model and effort of the open chat (or of the draft chat before its first message). null = the agent's default. */
  prefs: ChatPrefs;
  /** Puts the open chat on `model` ("<provider>/<id>") or back on the agent's default (null). Also the default for new chats. */
  setModel: (model: string | null) => Promise<void>;
  /** Sets the open chat's thinking effort or back to the agent's default (null). Also the default for new chats. */
  setEffort: (effort: Effort | null) => Promise<void>;
  /** Starts a draft chat with this agent. It also becomes the default agent for new chats. */
  setAgent: (agentId: string) => void;
  /** Sends the last user message again (with its images) as a new turn. */
  retry: () => Promise<void>;
  /** Thinking and steps of the run that produced an assistant message (live, or from history), or null when there were none. */
  processFor: (messageId: string) => AnswerProcess | null;
  /** Messages typed while a run was streaming, waiting to be sent in order. Cleared when the open chat changes. */
  queue: ReadonlyArray<QueuedTurn>;
  /** True when queued messages wait for resumeQueue() (a run failed or was stopped). */
  queuePaused: boolean;
  /** Removes a queued message and returns it (so the UI can put its text back into the field). */
  dequeue: (id: string) => QueuedTurn | undefined;
  /** Steers the running reply with a queued message and removes it from the queue (idle: just sends it). */
  sendNow: (id: string) => Promise<void>;
  /** Sends the queued messages again after a failure or a stop. */
  resumeQueue: () => Promise<void>;
  /** The images the user attached to a message of this session (empty after a restart: the gateway does not return them). */
  imagesFor: (messageId: string) => PickedImage[];
};

const ChatContext = createContext<ChatApi | null>(null);

export function useChat(): ChatApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <AnoProvider>');
  return ctx;
}

/** Registers the OpenClawAgent with CopilotKit before any child renders, then hosts the chat. */
function AgentHost({ children }: { children: React.ReactNode }) {
  const { copilotkit } = useCopilotKit();
  const { gateway } = useAno();
  const registered = useRef<OpenClawAgent | null>(null);
  if (!registered.current) {
    // Only the chat's agent drives the global orb; canvas runners make their own agents without it.
    const agent = new OpenClawAgent(gateway, getAnoAgentHooks(), { orb: orbSignal });
    copilotkit.addAgent__unsafe_dev_only({ id: ANO_AGENT_ID, agent });
    registered.current = agent;
  }
  return <ChatHost agent={registered.current}>{children}</ChatHost>;
}

function ChatHost({ agent, children }: { agent: OpenClawAgent; children: React.ReactNode }) {
  const { copilotkit } = useCopilotKit();
  const { gateway, connection, threadsStore, threads, settingsLoaded } = useAno();
  // Subscribes this component to message and run-state changes (throttled while streaming).
  useAgent({
    agentId: ANO_AGENT_ID,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged, UseAgentUpdate.OnStateChanged],
    throttleMs: 50,
  });

  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const bootstrapped = useRef(false);
  const images = useRef<ImageStore | null>(null);
  if (!images.current) images.current = new ImageStore();
  const imageStore = images.current;
  /** The message of the latest RUN_ERROR, so a run that ends in an error counts as failed. */
  const runError = useRef<string | null>(null);
  // The queue calls the newest runTurn (below); it is created once.
  const runTurnRef = useRef<(turn: QueuedTurn) => Promise<void>>(async () => undefined);
  const queueRef = useRef<SendQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new SendQueue({
      isRunning: () => agent.isRunning,
      run: (turn) => runTurnRef.current(turn),
      steer: (turn) => steerTurn(agent, imageStore, turn),
      onError: (e) => setError(e instanceof Error && e.message ? e.message : 'Could not send the message'),
      newId: randomUUID,
    });
  }
  const queue = queueRef.current;
  const queued = useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);

  // Surface run errors (RUN_ERROR from the adapter) as a banner, not as a message.
  useEffect(() => {
    const sub = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        runError.current = event.message || 'Something went wrong';
        setError(runError.current);
      },
      onRunFailed: ({ error: e }) => {
        runError.current = e.message || 'Something went wrong';
        setError(runError.current);
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  const openThread = useCallback(
    async (key: string) => {
      queue.reset();
      setError(null);
      threadsStore.setActive(key);
      setLoadingHistory(true);
      try {
        await agent.openThread(key);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load this thread');
      } finally {
        setLoadingHistory(false);
      }
    },
    [agent, threadsStore, queue],
  );

  const newThread = useCallback(
    (project: string | null = null) => {
      queue.reset();
      setError(null);
      threadsStore.setActive(null, project);
      agent.selectThread(`draft:${randomUUID()}`);
    },
    [agent, threadsStore, queue],
  );

  // On every (re)connect: refresh the list, then (first time only) open the right thread.
  useEffect(() => {
    if (!settingsLoaded || connection.status !== 'ready') return;
    let cancelled = false;
    (async () => {
      await threadsStore.refresh();
      if (cancelled) return;
      const state = threadsStore.getState();
      if (!bootstrapped.current) {
        bootstrapped.current = true;
        const stored = await threadsStore.restoreActiveKey();
        const pick = state.threads.find((t) => t.key === stored) ?? state.threads[0];
        if (pick) await openThread(pick.key);
        else newThread(null);
      } else if (state.activeKey && !agent.isRunning) {
        // Reconnected: resync the open thread (picks up an in-flight run or Telegram-side changes).
        void agent.openThread(state.activeKey).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.status, connection.readyCount, settingsLoaded]);

  // One turn: create the chat when it is still a draft, add the message, run the agent. Rejects when the run failed.
  const runTurn = async (turn: QueuedTurn) => {
    setError(null);
    runError.current = null;
    let key = threadsStore.getState().activeKey;
    if (!key) {
      // Draft thread: create the session now (no empty sessions on the gateway).
      const created = await threadsStore.create(threadsStore.getState().draftProject);
      key = created.key;
      agent.selectThread(key);
    }
    const wasDefaultTitle = threadsStore.activeThread()?.title === DEFAULT_THREAD_TITLE;
    await catalogSeenReady;
    const runAgentTurn = async () => {
      startTurn(agent, imageStore, turn);
      // copilotkit.runAgent (not agent.runAgent) so frontend tools run the CopilotKit way.
      await copilotkit.runAgent({ agent });
      if (runError.current) throw new Error(runError.current);
    };
    if (turn.once) {
      await withBrain((method, params) => gateway.request(method, params), key, turn.once, threadsStore.prefsFor(key), runAgentTurn);
    } else {
      await runAgentTurn();
    }
    if (wasDefaultTitle) await threadsStore.autoTitle(key, turn.text);
    void threadsStore.refresh();
  };
  runTurnRef.current = runTurn;

  // A run that did not come from the queue (a [ui-event], an adopted run) ended: send what is waiting.
  const running = agent.isRunning;
  useEffect(() => {
    if (!running) void queue.flush();
  }, [running, queue]);

  const send = useCallback(
    async (text: string, opts?: { images?: PickedImage[]; once?: { model: string | null; effort: Effort | null } }) => {
      const attached = opts?.images ?? [];
      const trimmed = text.trim();
      if (!trimmed && attached.length === 0) return;
      await queue.send(trimmed || imageOnlyPrompt(attached.length), attached, opts?.once);
    },
    [queue],
  );

  const retry = useCallback(async () => {
    const turn = planRetry(agent.messages, imageStore);
    if (turn) await send(turn.text, { images: turn.images });
  }, [agent, imageStore, send]);

  const setModel = useCallback(
    async (model: string | null) => {
      setError(null);
      try {
        const key = threadsStore.getState().activeKey;
        if (key) await threadsStore.setThreadModel(key, model);
        threadsStore.setDefaults({ model });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not change the model');
      }
    },
    [threadsStore],
  );

  const setEffort = useCallback(
    async (effort: Effort | null) => {
      setError(null);
      try {
        const key = threadsStore.getState().activeKey;
        if (key) await threadsStore.setThreadEffort(key, effort);
        threadsStore.setDefaults({ effort });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not change the effort');
      }
    },
    [threadsStore],
  );

  const setAgent = useCallback(
    (agentId: string) => {
      threadsStore.setDefaults({ agentId });
      newThread(null);
    },
    [threadsStore, newThread],
  );

  const sendUiEvent = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !threadsStore.getState().activeKey) return;
      setError(null);
      try {
        await catalogSeenReady;
        if (agent.isRunning) {
          await agent.steer({ id: randomUUID(), text: trimmed });
          return;
        }
        agent.addMessage({ id: randomUUID(), role: 'user', content: trimmed });
        await copilotkit.runAgent({ agent });
        void threadsStore.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not send the interaction');
      }
    },
    [agent, copilotkit, threadsStore],
  );

  const stop = useCallback(() => {
    // Pause first: stopping must not send the next queued message by itself.
    queue.pause();
    agent.abortRun();
  }, [agent, queue]);

  const agentState: { activity?: RunActivity } | undefined = agent.state;

  const activeKey = threads.activeKey;
  const activeAgentId = threads.threads.find((t) => t.key === activeKey)?.agentId ?? (activeKey ? agentIdOfKey(activeKey) : null);
  const sessionPrefs = activeKey ? threadsStore.prefsFor(activeKey) : null;
  const prefs: ChatPrefs = sessionPrefs
    ? { agentId: activeAgentId ?? threads.defaults.agentId, model: sessionPrefs.model, effort: asEffort(sessionPrefs.effort) }
    : threads.defaults;

  const chat: ChatApi = {
    agent,
    messages: agent.messages,
    isRunning: agent.isRunning,
    activity: agentState?.activity ?? null,
    error,
    clearError: () => setError(null),
    send,
    sendUiEvent,
    stop,
    openThread,
    newThread,
    loadingHistory,
    prefs,
    setModel,
    setEffort,
    setAgent,
    retry,
    processFor: (messageId) => agent.processFor(messageId),
    queue: queued.items,
    queuePaused: queued.paused,
    dequeue: (id) => queue.dequeue(id),
    sendNow: (id) => queue.sendNow(id),
    resumeQueue: () => queue.resume(),
    imagesFor: (messageId) => imageStore.get(messageId),
  };

  // `threads` is read so the context re-renders consumers when the list changes.
  void threads;
  void gateway;
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}
