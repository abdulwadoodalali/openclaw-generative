// The agents the chat can talk to, from the gateway's `agents.list` (works with operator.read).
// Cached in memory for a few minutes, like src/canvas/models.ts. Pure (no react / react-native / expo).
import type { RequestFn } from '../openclaw/sessionsApi.ts';
import { isPlainObject } from '../canvas/types.ts';
import type { RunActivity } from '../openclaw/OpenClawAgent.ts';
import { DEFAULT_AGENT_ID, OPENCLAW_DEFAULT_AGENT } from '../env.ts';

export type AgentOption = {
  id: string;
  /** Display name, e.g. "Ano General". */
  name: string;
  /** One letter for the avatar badge. */
  initial: string;
  /** One line under the name in the picker. */
  hint: string;
  /** Thinking levels this agent's model accepts (raw gateway values, e.g. "xhigh"). */
  thinkingLevels: string[];
  /** The agent's default thinking level, or null. */
  thinkingDefault: string | null;
  /** The agent's primary model ref ("<provider>/<id>"), or null. */
  defaultModel: string | null;
};

export const AGENTS_CACHE_MS = 5 * 60 * 1000;

/** One-line hints for common agent ids. Anything else gets none. */
const HINTS: Record<string, string> = {
  main: 'Your main OpenClaw agent',
  finance: 'Budget, spending, accounts',
  notes: 'Notes and research',
  household: 'Shared with your household',
};

function hintFor(id: string): string {
  if (id.startsWith('pa-')) return 'Specialist';
  return HINTS[id] ?? '';
}

/** "my-finance" -> "My Finance". */
function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** "Ano General" -> "G", "Ano" -> "A", "PA Alex" -> "P". */
function initialFor(name: string): string {
  const rest = name.replace(/^ano\s+/i, '');
  const letter = /[\p{L}\p{N}]/u.exec(rest.length > 0 ? rest : name);
  return letter ? letter[0].toUpperCase() : '?';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function modelRef(model: unknown): string | null {
  if (typeof model === 'string') return stringOrNull(model);
  return isPlainObject(model) ? stringOrNull(model.primary) : null;
}

/**
 * Turns an `agents.list` result into picker rows: the default agent first (EXPO_PUBLIC_ANO_DEFAULT_AGENT),
 * then OpenClaw's `main`, then the rest in gateway order.
 */
export function parseAgents(result: unknown, defaultAgentId: string = DEFAULT_AGENT_ID): AgentOption[] {
  const list = isPlainObject(result) ? result.agents : undefined;
  if (!Array.isArray(list)) return [];
  const rows: { agent: AgentOption; index: number }[] = [];
  for (const row of list) {
    if (!isPlainObject(row)) continue;
    const id = stringOrNull(row.id);
    if (!id) continue;
    const identityName = isPlainObject(row.identity) ? stringOrNull(row.identity.name) : null;
    const name = stringOrNull(row.name) ?? identityName ?? titleFromId(id);
    rows.push({
      index: rows.length,
      agent: {
        id,
        name,
        initial: initialFor(name),
        hint: hintFor(id),
        thinkingLevels: Array.isArray(row.thinkingOptions)
          ? row.thinkingOptions.filter((level): level is string => typeof level === 'string')
          : [],
        thinkingDefault: stringOrNull(row.thinkingDefault),
        defaultModel: modelRef(row.model),
      },
    });
  }
  const order = [defaultAgentId, OPENCLAW_DEFAULT_AGENT];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i >= 0 ? i : order.length;
  };
  rows.sort((a, b) => rank(a.agent.id) - rank(b.agent.id) || a.index - b.index);
  return rows.map((r) => r.agent);
}

/** Which tint an agent's face uses: sage for the household agents, amber for everyone else. */
export function agentTone(id: string): 'accent' | 'household' {
  return id.startsWith('household') ? 'household' : 'accent';
}

/**
 * The status line under the agent's name: "Offline" when the gateway is not connected, "Here with you"
 * when idle, otherwise what the run is doing. Pass `null` as `activity` when no run is going (the
 * agent keeps the last activity of a finished run).
 */
export function agentStatus(activity: RunActivity | null, connection: { status: string }): string {
  if (connection.status !== 'ready') return 'Offline';
  if (!activity) return 'Here with you';
  if (activity.step) return activity.step;
  if (activity.mode === 'answering') return 'Answering';
  return 'Thinking';
}

let cache: { at: number; agents: AgentOption[] } | null = null;
let inflight: Promise<AgentOption[]> | null = null;

/** The gateway's agents (cached for 5 minutes; concurrent callers share one request). A failed request is not cached. */
export function loadAgents(request: RequestFn, now: () => number = Date.now): Promise<AgentOption[]> {
  if (cache && now() - cache.at < AGENTS_CACHE_MS) return Promise.resolve(cache.agents);
  if (inflight) return inflight;
  const pending = request('agents.list', {})
    .then((result) => {
      const agents = parseAgents(result);
      cache = { at: now(), agents };
      return agents;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = pending;
  return pending;
}

/** Forgets the cached agents (tests, switching gateways). */
export function clearAgentsCache(): void {
  cache = null;
  inflight = null;
}
