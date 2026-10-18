// One long-lived connection to the OpenClaw gateway, built on the official browser-safe client
// (@openclaw/gateway-client/browser). The package owns the handshake, request correlation,
// reconnect backoff and the sequence-gap check. This file supplies the host pieces:
// a WebSocket adapter, the Ed25519 device identity, token storage and the status state machine.
//
// Deliberately free of react-native and expo imports (everything platform specific is injected
// through GatewayDeps) so the exact same code runs under Node for the live smoke test.
import {
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  classifyGatewayConnectFailure,
  readConnectErrorDetailCode,
  readPairingConnectErrorDetails,
  type EventFrame,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceIdentity,
  type GatewayBrowserDeviceTokenStore,
  type GatewayProtocolCloseContext,
  type GatewayProtocolSocket,
  type GatewayProtocolSocketHandlers,
  type HelloOk,
} from '@openclaw/gateway-client/browser';
import { isRepairCode, isRepairPairingReason } from '../connectPolicy.ts';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'needs-pairing'
  | 'auth-failed'
  | 'error';

export type ConnectionInfo = {
  status: ConnectionStatus;
  /** Short human readable reason for the current status (shown in the settings sheet). */
  detail?: string;
  /** Set while status is needs-pairing: the id to approve with `openclaw devices approve`. */
  pairingRequestId?: string;
  /** Set with auth-failed: the gateway's detail or error code (e.g. AUTH_TOKEN_MISMATCH, NOT_PAIRED). */
  failureCode?: string;
  /** Set with auth-failed: the rejected credential was the stored device token (not a pasted token). */
  failureUsedStoredToken?: boolean;
  /** Gateway version string from hello-ok. */
  serverVersion?: string;
  /** Increments on every successful (re)connect, so consumers can resync state. */
  readyCount: number;
};

/** The subset of the WebSocket API we use. RN, browsers and Node 22+ all satisfy it. */
export type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type GatewayDeps = {
  createWebSocket: (url: string) => WebSocketLike;
  /** Loads (or creates once and persists) the Ed25519 device identity. */
  loadIdentity: () => Promise<GatewayBrowserDeviceIdentity>;
  /** Persists the per-device token the gateway issues after pairing. */
  tokenStore: GatewayBrowserDeviceTokenStore;
  createId: () => string;
  /** Platform label sent to the gateway. The official iOS app sends "ios" / "iphone". */
  platform?: string;
  deviceFamily?: string;
  displayName?: string;
  locale?: string;
  clientVersion?: string;
  /** Called once a device token was stored, so the shared gateway token can be dropped. */
  onPaired?: () => void;
  /** Debug logger, never receives secrets. */
  log?: (line: string) => void;
};

export type GatewayConfig = {
  url: string;
  /** Shared gateway token. Only needed until the device is paired. */
  gatewayToken?: string;
};

export type GatewayEventListener = (event: EventFrame) => void;

const OPEN = 1;
const CLIENT_ID = 'openclaw-ios' as const;
const CLIENT_MODE = 'ui' as const;
const ROLE = 'operator';
const SCOPES = ['operator.read', 'operator.write'] as const;
// Advertise only what the app implements. Never inline-widgets (no HTML widgets, ever).
const CAPS = ['tool-events', 'chat-only-assistant-text'] as const;
const TICK_FALLBACK_MS = 30_000;
const PAIRING_RETRY_MS = 4_000;

/** Wraps a platform WebSocket in the adapter shape the protocol client expects. */
function adaptSocket(ws: WebSocketLike, h: GatewayProtocolSocketHandlers): GatewayProtocolSocket {
  ws.onopen = () => h.open();
  ws.onmessage = (ev) => h.message(typeof ev.data === 'string' ? ev.data : String(ev.data));
  ws.onclose = (ev) => h.close(ev.code, ev.reason ?? '');
  ws.onerror = () => h.error(new Error('websocket error'));
  return {
    isOpen: () => ws.readyState === OPEN,
    send: (data) => ws.send(data),
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        // React Native rejects close codes outside 1000 and 3000-4999.
        try {
          ws.close();
        } catch {
          // already closed
        }
      }
    },
  };
}

export class GatewayConnection {
  private readonly deps: GatewayDeps;
  private readonly lifecycle: GatewayBrowserDeviceAuthLifecycle;
  private client: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan> | null = null;
  private config: GatewayConfig = { url: '' };
  private info: ConnectionInfo = { status: 'idle', readyCount: 0 };
  private readonly eventListeners = new Set<GatewayEventListener>();
  private readonly statusListeners = new Set<() => void>();
  private tickMs = TICK_FALLBACK_MS;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by start()/stop() so callbacks of a retired client are ignored. */
  private epoch = 0;
  private hadStoredTokenOnConnect = false;
  /** Consecutive explicit device-token rejections. One is forgiven (a restarting gateway can glitch). */
  private deviceRejections = 0;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
    this.lifecycle = new GatewayBrowserDeviceAuthLifecycle({
      loadIdentity: () => deps.loadIdentity(),
      tokenStore: deps.tokenStore,
    });
  }

  // ---- public API -------------------------------------------------------------------------

  getInfo = (): ConnectionInfo => this.info;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  onEvent(listener: GatewayEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Open (or reopen with new settings) the connection. */
  start(config: GatewayConfig): void {
    this.stop();
    this.config = config;
    if (!config.url.trim()) {
      this.setInfo({ status: 'error', detail: 'Add the gateway address in Settings.' });
      return;
    }
    const epoch = ++this.epoch;
    this.setInfo({ status: 'connecting', detail: undefined, pairingRequestId: undefined, failureCode: undefined, failureUsedStoredToken: undefined });
    this.client = this.createClient(epoch);
    this.client.start();
  }

  stop(): void {
    this.epoch++;
    this.clearWatchdog();
    const client = this.client;
    this.client = null;
    client?.stop();
    if (this.info.status !== 'idle') this.setInfo({ status: 'idle', detail: undefined, pairingRequestId: undefined });
  }

  /**
   * The app is back in the foreground after `awayMs`. iOS freezes the socket in the background, and
   * the reconnect timer with it, so reconnect now instead of waiting out a backoff or the tick
   * watchdog. A short trip away with a live socket changes nothing; a connection that is idle,
   * waiting for approval or rejected is left alone.
   */
  resume(awayMs: number): void {
    const { status } = this.info;
    if (status !== 'ready' && status !== 'connecting' && status !== 'reconnecting') return;
    if (this.isReady() && awayMs < this.tickMs) return;
    this.start(this.config);
  }

  isReady(): boolean {
    return this.info.status === 'ready' && !!this.client?.connected;
  }

  /** Send a request. Rejects fast when the socket is not connected. */
  request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const client = this.client;
    if (!client) return Promise.reject(new Error('Not connected to the gateway'));
    return client.request<T>(method, params ?? {}, timeoutMs === undefined ? undefined : { timeoutMs });
  }

  /** Resolves when the connection is ready, rejects after timeoutMs. */
  waitUntilReady(timeoutMs = 10_000): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Gateway is not reachable'));
      }, timeoutMs);
      const off = this.subscribeStatus(() => {
        const status = this.info.status;
        if (status === 'ready') {
          clearTimeout(timer);
          off();
          resolve();
        } else if (status === 'auth-failed' || status === 'needs-pairing' || status === 'error') {
          clearTimeout(timer);
          off();
          reject(new Error(this.info.detail ?? 'Gateway connection failed'));
        }
      });
    });
  }

  // ---- internals --------------------------------------------------------------------------

  private setInfo(patch: Partial<ConnectionInfo>): void {
    this.info = { ...this.info, ...patch };
    for (const l of [...this.statusListeners]) l();
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }

  private clientInfo() {
    return {
      id: CLIENT_ID,
      displayName: this.deps.displayName ?? 'Ano RN',
      version: this.deps.clientVersion ?? '0.1.0',
      platform: this.deps.platform ?? 'ios',
      deviceFamily: this.deps.deviceFamily ?? 'iphone',
      mode: CLIENT_MODE,
    };
  }

  private armWatchdog(epoch: number): void {
    this.clearWatchdog();
    // The gateway ticks every tickIntervalMs. Silence for 2 ticks means a dead socket: close with
    // 4000 and let the client reconnect (same rule as the official client).
    this.watchdog = setTimeout(() => {
      if (epoch !== this.epoch) return;
      this.log('tick watchdog: closing silent socket');
      this.client?.closeSocket(4000, 'tick timeout');
    }, this.tickMs * 2);
  }

  /** Status for "the socket is down and we are retrying": reconnecting once we were ready before. */
  private reconnectingStatus(): ConnectionStatus {
    return this.info.readyCount > 0 ? 'reconnecting' : 'connecting';
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private createClient(epoch: number): GatewayProtocolClient<GatewayBrowserDeviceAuthPlan> {
    const { url, gatewayToken } = this.config;
    const live = () => epoch === this.epoch;

    return new GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>({
      createSocket: (handlers) => adaptSocket(this.deps.createWebSocket(url), handlers),
      createRequestId: () => this.deps.createId(),
      handshake: { mode: 'require-challenge', timeoutMs: 15_000 },
      reconnect: { initialMs: 1_000, multiplier: 2, maxMs: 30_000 },
      requestTimeoutMs: 30_000,

      buildConnectPlan: async ({ nonce, challengeTs }) => {
        const plan = await this.lifecycle.buildPlan({
          client: this.clientInfo(),
          role: ROLE,
          defaultScopes: SCOPES,
          // The shared token is only a first-pairing credential. When both a token and a stored
          // device token exist the lifecycle uses the explicit token, so callers pass it only
          // while unpaired (or when the user pastes a fresh one to re-pair).
          token: gatewayToken || undefined,
          nonce,
          challengeTs,
        });
        this.hadStoredTokenOnConnect = !!plan.selectedAuth.storedToken;
        return plan;
      },

      buildConnectParams: (plan) => ({
        minProtocol: 4,
        maxProtocol: 4,
        client: this.clientInfo(),
        role: ROLE,
        scopes: plan.scopes,
        caps: [...CAPS],
        commands: [],
        permissions: {},
        auth: plan.auth,
        device: plan.device,
        locale: this.deps.locale ?? 'en-US',
        userAgent: `ano-rn/${this.deps.clientVersion ?? '0.1.0'}`,
      }),

      // Persist the issued device token before onHello fires.
      onConnectHello: async (hello: HelloOk, ctx) => {
        await this.lifecycle.acceptHello(hello, ctx.plan);
        if (hello.auth?.deviceToken) this.deps.onPaired?.();
      },

      onHello: (hello: HelloOk) => {
        if (!live()) return;
        const tick = hello.policy?.tickIntervalMs;
        this.tickMs = typeof tick === 'number' && tick > 0 ? tick : TICK_FALLBACK_MS;
        this.armWatchdog(epoch);
        this.deviceRejections = 0;
        this.setInfo({
          status: 'ready',
          detail: undefined,
          pairingRequestId: undefined,
          failureCode: undefined,
          failureUsedStoredToken: undefined,
          serverVersion: hello.server?.version,
          readyCount: this.info.readyCount + 1,
        });
      },

      onConnectFailure: async (error, ctx) => {
        if (!live()) return { closeCode: 1008, closeReason: 'retired', stop: true };
        const details = error.details;
        const code = readConnectErrorDetailCode(details);
        const classified = classifyGatewayConnectFailure({ details, message: error.message });
        this.log(`connect failed: ${code ?? error.gatewayCode}`);

        if (code === 'PAIRING_REQUIRED') {
          const pairing = readPairingConnectErrorDetails(details);
          // A stored device token the Mac no longer knows (device removed or revoked): the app re-pairs
          // by itself through ano-pair instead of waiting for a manual approval.
          if (this.hadStoredTokenOnConnect && !gatewayToken && isRepairPairingReason(pairing?.reason)) {
            this.setInfo({
              status: 'auth-failed',
              detail: 'This phone is no longer paired with the Mac. Pairing again.',
              pairingRequestId: undefined,
              failureCode: 'NOT_PAIRED',
              failureUsedStoredToken: true,
            });
            return { closeCode: 1008, closeReason: 'not paired', stop: true };
          }
          this.setInfo({
            status: 'needs-pairing',
            detail: classified.userMessage,
            pairingRequestId: pairing?.requestId,
          });
          // Keep polling: once the Mac approves the request the next attempt succeeds.
          return { closeCode: 1008, closeReason: 'pairing required', reconnectDelayMs: PAIRING_RETRY_MS };
        }

        const retryableCodes = new Set(['UNAVAILABLE']);
        if (retryableCodes.has(error.gatewayCode) || error.retryable) {
          this.setInfo({ status: this.reconnectingStatus(), detail: error.message });
          return { closeCode: 1013, closeReason: 'retry', reconnectDelayMs: error.retryAfterMs };
        }

        // A connect request that dies without a structured gateway answer (socket closed mid
        // handshake because the gateway is restarting, a proxy hiccup, a timeout) is an outage, not
        // an auth problem. Never wipe the pairing or show "Not authorised" for it: keep retrying
        // with the library's backoff. Only an explicit gateway answer (a detail code, or an auth
        // message) is treated as a rejection.
        const transient = !code && !isRepairCode(error.gatewayCode) && (classified.kind === 'unreachable' || classified.kind === 'gateway-rejected');
        if (transient) {
          this.setInfo({ status: this.reconnectingStatus(), detail: 'Cannot reach the gateway. Is Tailscale on?' });
          return { closeCode: 1013, closeReason: 'retry' };
        }

        // A stored device token the gateway explicitly rejects (revoked or rotated) must go,
        // otherwise every future connect fails the same way. Rate limits, scope problems and
        // origin or proxy rejections say nothing about the token, so those keep it. The first
        // rejection after a working session is forgiven once: wiping a pairing costs the user a
        // trip to the Mac, a retry costs two seconds.
        const deviceTokenRejected =
          code === 'AUTH_DEVICE_TOKEN_MISMATCH' || (code === 'AUTH_TOKEN_MISMATCH' && !gatewayToken);
        if (this.hadStoredTokenOnConnect && !gatewayToken && deviceTokenRejected) {
          if (this.info.readyCount > 0 && this.deviceRejections === 0) {
            this.deviceRejections++;
            this.setInfo({ status: 'reconnecting', detail: 'Gateway restarting' });
            return { closeCode: 1013, closeReason: 'retry', reconnectDelayMs: 2_000 };
          }
          await this.lifecycle.clearStoredToken(ctx.plan).catch(() => undefined);
        }
        // The gateway answers "token missing" before it creates any pairing request, so a first
        // pairing always needs the shared token pasted in Settings.
        const tokenMissing = code === 'AUTH_TOKEN_MISSING' || /token missing/i.test(error.message ?? '');
        const hint =
          code === 'CONTROL_UI_ORIGIN_NOT_ALLOWED'
            ? 'The gateway rejected this browser origin. Use Expo Go on the phone, or allow the origin on the gateway.'
            : tokenMissing
              ? 'Paste the gateway token in Settings to pair this device.'
              : classified.userMessage;
        this.setInfo({
          status: 'auth-failed',
          detail: hint,
          pairingRequestId: undefined,
          failureCode: code ?? error.gatewayCode,
          failureUsedStoredToken: this.hadStoredTokenOnConnect && !gatewayToken,
        });
        return { closeCode: 1008, closeReason: 'auth failed', stop: true };
      },

      resolveClose: (ctx: GatewayProtocolCloseContext) => {
        const stopped = !live();
        return { retry: !stopped, notify: true };
      },

      onClose: (ctx, decision) => {
        if (!live()) return;
        this.clearWatchdog();
        const status = this.info.status;
        // Keep needs-pairing / auth-failed visible. Otherwise show that we are retrying.
        if (decision.retry && status !== 'needs-pairing' && status !== 'auth-failed') {
          this.setInfo({
            status: this.reconnectingStatus(),
            detail: ctx.socketOpened ? undefined : 'Cannot reach the gateway. Is Tailscale on?',
          });
        }
      },

      onConnectError: (error) => {
        if (!live()) return;
        this.log(`connect error: ${error.message}`);
        if (this.info.status === 'connecting' || this.info.status === 'reconnecting') {
          this.setInfo({ detail: 'Cannot reach the gateway. Is Tailscale on?' });
        }
      },

      onGap: (gap) => this.log(`event gap expected=${gap.expected} received=${gap.received}`),
      onActivity: () => {
        if (live() && this.info.status === 'ready') this.armWatchdog(epoch);
      },
      onEvent: (event) => {
        if (!live()) return;
        for (const l of [...this.eventListeners]) {
          try {
            l(event);
          } catch (e) {
            this.log(`event listener threw: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      },
      onCallbackError: (label, error) =>
        this.log(`callback ${label} threw: ${error instanceof Error ? error.message : String(error)}`),
    });
  }
}
