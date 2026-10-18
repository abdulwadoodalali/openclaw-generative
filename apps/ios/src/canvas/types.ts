// Canvas data model. Pure TypeScript (no react / react-native / expo), see protocol.ts for the wire format.
import { COMPONENT_NAME_RE } from '../genui/types.ts';

export type CanvasScope = 'private' | 'household';
export type CanvasAuthor = 'ano' | 'you';
/** Same shape as an `ano-ui` fence. */
export type CanvasBlock = { component: string; props: Record<string, unknown> };
export type CanvasVersion = {
  version: number;
  title: string;
  blocks: CanvasBlock[];
  at: number;
  by: CanvasAuthor;
  summary: string;
};
/** When a canvas re-reads its data. 'daily' = the first time it is seen after 06:00 local each day. */
export type RefreshPolicy = 'manual' | 'open' | 'hourly' | 'daily';
export const REFRESH_POLICIES: readonly RefreshPolicy[] = ['manual', 'open', 'hourly', 'daily'];

/** The agent that operates one canvas. App-side only: the phone cannot create OpenClaw agents. */
export type CanvasAgent = {
  /** null = plain "Ano"; a name means the user created an agent for this canvas. */
  name: string | null;
  /** What this canvas is for and how to keep it ('' = none), at most MAX_INSTRUCTIONS_LENGTH characters. */
  instructions: string;
  /** "<provider>/<id>" from models.list, null = the OpenClaw agent's default. */
  model: string | null;
  /** The model's display name when it was chosen ("Kimi K3"), so the canvas can show it without asking the gateway. */
  modelName: string | null;
  /** OpenClaw agent the session runs under, null = settings.agentId. */
  agentId: string | null;
  refresh: RefreshPolicy;
};

export type CanvasOrigin = { prompt: string; sessionKey?: string; at: number };

export type Canvas = {
  id: string;
  title: string;
  scope: CanvasScope;
  pinned: boolean;
  /** 'home' is the generative Home canvas (id HOME_CANVAS_ID), never listed in Canvases. */
  kind: 'user' | 'home';
  version: number;
  updatedAt: number;
  updatedBy: CanvasAuthor;
  summary: string;
  blocks: CanvasBlock[];
  /** Oldest to newest, includes the current version, capped at MAX_HISTORY. */
  history: CanvasVersion[];
  /** OpenClaw session used for "edit by asking" turns on this canvas. */
  sessionKey?: string;
  /** Locked: taps open a chat about the thing, only Refresh changes the canvas (values only). Unlocked: taps and the composer edit it. */
  locked: boolean;
  agent: CanvasAgent;
  /** The chat question the canvas came from (used by refresh). */
  origin?: CanvasOrigin;
  lastRefreshedAt?: number;
};

export const MAX_BLOCKS = 40;
export const MAX_TITLE_LENGTH = 80;
export const MAX_SUMMARY_LENGTH = 120;
export const MAX_HISTORY = 30;
export const MAX_INSTRUCTIONS_LENGTH = 2000;
export const MAX_AGENT_NAME_LENGTH = 40;
export const MAX_ORIGIN_PROMPT_LENGTH = 2000;

export const DEFAULT_AGENT: CanvasAgent = { name: null, instructions: '', model: null, modelName: null, agentId: null, refresh: 'manual' };

/** The default agent of a canvas of `kind` (the Home canvas refreshes daily). */
export function defaultAgent(kind: Canvas['kind']): CanvasAgent {
  return kind === 'home' ? { ...DEFAULT_AGENT, refresh: 'daily' } : { ...DEFAULT_AGENT };
}

function nullableString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, max).trim() || null;
}

/** `base` with every valid field of `patch` applied (names, instructions and ids are trimmed and clamped). */
export function mergeAgent(base: CanvasAgent, patch: unknown): CanvasAgent {
  if (!isPlainObject(patch)) return base;
  const next = { ...base };
  const name = 'name' in patch ? nullableString(patch.name, MAX_AGENT_NAME_LENGTH) : undefined;
  if (name !== undefined) next.name = name;
  const model = 'model' in patch ? nullableString(patch.model, 200) : undefined;
  if (model !== undefined) {
    next.model = model;
    // A new model without a name of its own must not keep the old model's name.
    if (!('modelName' in patch)) next.modelName = null;
  }
  const modelName = 'modelName' in patch ? nullableString(patch.modelName, 80) : undefined;
  if (modelName !== undefined) next.modelName = next.model ? modelName : null;
  const agentId = 'agentId' in patch ? nullableString(patch.agentId, 100) : undefined;
  if (agentId !== undefined) next.agentId = agentId;
  if (typeof patch.instructions === 'string') next.instructions = patch.instructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH);
  const refresh = REFRESH_POLICIES.find((policy) => policy === patch.refresh);
  if (refresh) next.refresh = refresh;
  return next;
}

export function sameAgent(a: CanvasAgent, b: CanvasAgent): boolean {
  return (
    a.name === b.name &&
    a.instructions === b.instructions &&
    a.model === b.model &&
    a.modelName === b.modelName &&
    a.agentId === b.agentId &&
    a.refresh === b.refresh
  );
}

/**
 * The component structure of `blocks`: component names in order, recursively through `props.children`.
 * Two block lists with the same signature differ only in values.
 */
export function layoutSignature(blocks: unknown, depth = 0): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      if (!isPlainObject(block) || typeof block.component !== 'string') return '?';
      const children = depth < 16 && isPlainObject(block.props) ? layoutSignature(block.props.children, depth + 1) : '';
      return children ? `${block.component}(${children})` : block.component;
    })
    .join(',');
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Null when `value` is a valid block, otherwise a readable reason. `where` names it in the message. */
export function checkBlock(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where} must be an object {component, props}`;
  if (typeof value.component !== 'string' || !COMPONENT_NAME_RE.test(value.component)) {
    return `${where}.component must be a component name (letters and digits, starting with a letter)`;
  }
  if (!isPlainObject(value.props)) return `${where}.props must be an object`;
  return null;
}

/** Null when `value` is a valid block list, otherwise a readable reason. */
export function checkBlocks(value: unknown, where = 'blocks'): string | null {
  if (!Array.isArray(value)) return `${where} must be an array`;
  if (value.length > MAX_BLOCKS) return `${where} has ${value.length} blocks, the maximum is ${MAX_BLOCKS}`;
  for (let i = 0; i < value.length; i += 1) {
    const problem = checkBlock(value[i], `${where}[${i}]`);
    if (problem) return problem;
  }
  return null;
}

/** Null when `value` is a valid canvas title. */
export function checkTitle(value: unknown, where = 'title'): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return `${where} must be a non-empty string`;
  if (value.length > MAX_TITLE_LENGTH) return `${where} is ${value.length} characters, the maximum is ${MAX_TITLE_LENGTH}`;
  return null;
}
