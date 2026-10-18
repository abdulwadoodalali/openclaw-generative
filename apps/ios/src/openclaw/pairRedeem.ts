// Redeems an ano-pair bootstrap token (PAIRING.md section 4, step 1 and 2). No react-native or expo
// imports. Reuses the official gateway client: GatewayBrowserDeviceAuthLifecycle already builds the
// bootstrap-token connect plan and signs the v3 payload with the bootstrap token in the token slot,
// and GatewayProtocolClient owns the socket, challenge and request correlation.
//
// This connect is NODE shaped on purpose (official iOS client id, mode node, role node, empty
// scopes): that is what makes the gateway pair silently. The node token that comes back is dropped
// on the floor. Only the operator entry of hello-ok.auth.deviceTokens is returned. The bootstrap
// token and every device token stay out of logs and error messages.
import {
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  readConnectErrorDetailCode,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceIdentity,
  type GatewayProtocolSocket,
  type GatewayProtocolSocketHandlers,
  type HelloOk,
} from '@openclaw/gateway-client/browser';
import type { PairGrant } from './pairClient.ts';
import type { WebSocketLike } from './gatewayConnection.ts';

/** Scopes the app actually uses. The grant carries more (approvals, talk.secrets); we keep only these. */
export const OPERATOR_SCOPES = ['operator.read', 'operator.write'] as const;
export const REDEEM_TIMEOUT_MS = 20_000;
const OPEN = 1;

export type OperatorCredential = { deviceToken: string; scopes: string[] };

export class RedeemError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RedeemError';
    this.code = code;
  }
}

export type RedeemDeps = {
  createWebSocket: (url: string) => WebSocketLike;
  identity: GatewayBrowserDeviceIdentity;
  createId: () => string;
  displayName: string;
  clientVersion?: string;
  timeoutMs?: number;
};

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
        try {
          ws.close();
        } catch {
          // already closed
        }
      }
    },
  };
}

/** Picks the operator credential out of hello-ok.auth, keeping only the scopes the app uses. */
export function pickOperatorCredential(hello: Pick<HelloOk, 'auth'>): OperatorCredential | null {
  const entry = (hello.auth?.deviceTokens ?? []).find((d) => d.role === 'operator' && typeof d.deviceToken === 'string' && d.deviceToken);
  if (!entry) return null;
  const scopes = OPERATOR_SCOPES.filter((s) => entry.scopes.includes(s));
  return { deviceToken: entry.deviceToken, scopes: scopes.length ? [...scopes] : [...OPERATOR_SCOPES] };
}

export function redeemBootstrap(deps: RedeemDeps, grant: PairGrant): Promise<OperatorCredential> {
  const { redeem } = grant;
  // The bootstrap handoff is never stored: the throwaway store makes the lifecycle forget the node token.
  const lifecycle = new GatewayBrowserDeviceAuthLifecycle({
    loadIdentity: async () => deps.identity,
    tokenStore: { load: () => null, store: () => undefined, clear: () => undefined },
  });
  const client = {
    id: redeem.clientId,
    displayName: deps.displayName,
    version: deps.clientVersion ?? '0.1.0',
    platform: redeem.platform,
    deviceFamily: redeem.deviceFamily,
    mode: redeem.clientMode,
  } as never;

  return new Promise<OperatorCredential>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let gw: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan> | null = null;
    const finish = (err: Error | null, value?: OperatorCredential) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        gw?.stop();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value as OperatorCredential);
    };

    gw = new GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>({
      createSocket: (handlers) => adaptSocket(deps.createWebSocket(grant.gatewayUrl), handlers),
      createRequestId: () => deps.createId(),
      handshake: { mode: 'require-challenge', timeoutMs: 15_000 },
      reconnect: { initialMs: 1_000, multiplier: 2, maxMs: 1_000 },
      requestTimeoutMs: 15_000,
      buildConnectPlan: ({ nonce, challengeTs }) =>
        lifecycle.buildPlan({
          client,
          role: redeem.role,
          defaultScopes: redeem.scopes,
          bootstrapScopes: redeem.scopes,
          bootstrapToken: grant.bootstrapToken,
          preferBootstrapToken: true,
          nonce,
          challengeTs,
        }),
      buildConnectParams: (plan) => ({
        minProtocol: redeem.minProtocol,
        maxProtocol: redeem.maxProtocol,
        client,
        role: redeem.role,
        scopes: plan.scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: plan.auth,
        device: plan.device,
        locale: 'en-US',
        userAgent: `ano-rn/${deps.clientVersion ?? '0.1.0'}`,
      }),
      onHello: (hello: HelloOk) => {
        const cred = pickOperatorCredential(hello);
        if (!cred) finish(new RedeemError('no_operator_token', 'The gateway issued no operator credential.'));
        else finish(null, cred);
      },
      onConnectFailure: (error) => {
        const code = readConnectErrorDetailCode(error.details) ?? error.gatewayCode ?? 'REDEEM_FAILED';
        finish(new RedeemError(String(code), `The gateway refused the pairing handoff (${String(code)}).`));
        return { closeCode: 1008, closeReason: 'redeem failed', stop: true };
      },
      onConnectPlanError: (error) => {
        finish(new RedeemError('PLAN_ERROR', error.message));
        return { closeCode: 1008, closeReason: 'plan failed', stop: true };
      },
      resolveClose: () => ({ retry: false, notify: true }),
      onClose: () => finish(new RedeemError('CLOSED', 'The gateway closed the connection during pairing.')),
      onConnectError: () => finish(new RedeemError('UNREACHABLE', 'Cannot reach the gateway.')),
      onSocketFactoryError: () => finish(new RedeemError('UNREACHABLE', 'Cannot reach the gateway.')),
    });

    timer = setTimeout(() => finish(new RedeemError('TIMEOUT', 'The gateway did not answer in time.')), deps.timeoutMs ?? REDEEM_TIMEOUT_MS);
    try {
      gw.start();
    } catch {
      finish(new RedeemError('UNREACHABLE', 'Cannot reach the gateway.'));
    }
  });
}
