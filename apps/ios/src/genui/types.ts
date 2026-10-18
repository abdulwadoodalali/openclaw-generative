// Shared contract for the generative UI layer (build 2). Pure TypeScript: no react, react-native or
// expo imports, so every module that imports it stays Node-testable. Only erasable TS syntax.
//
// Wire format (assistant text):
//   ```ano-ui      {"component":"Name","props":{...}}            -> AG-UI tool call render_<Name>
//   ```ano-define  {ComponentDefinition JSON}                    -> AG-UI tool call define_component
// Interaction back to the model (a normal chat.send user turn):
//   [ui-event] {"component":"Name","event":"<action>", ...payload}

export const RENDER_TOOL_PREFIX = 'render_';
export const DEFINE_TOOL_NAME = 'define_component';
/** ```ano-canvas fences become this tool call; args are the fence JSON (see src/canvas/protocol.ts). */
export const CANVAS_TOOL_NAME = 'canvas_update';
export const UI_EVENT_PREFIX = '[ui-event]';
export const COMPONENT_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export const LIMITS = {
  /** Max UTF-8 bytes of one fence body. Larger fences degrade to text. */
  maxFenceBytes: 32 * 1024,
  /** Max UTF-8 bytes of one serialized ComponentDefinition. */
  maxDefinitionBytes: 16 * 1024,
  maxDepth: 8,
  maxNodes: 200,
  maxActions: 8,
  /** Max nesting of the props JSON-schema subset. */
  maxSchemaDepth: 3,
  /** Target size of the catalog brief text. */
  catalogBriefBytes: 3 * 1024,
} as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The JSON-schema subset allowed for component props (compiled to Zod at load time). */
export type PropSchema = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: Array<string | number>;
  items?: PropSchema;
  properties?: Record<string, PropSchema>;
  required?: string[];
};

/** Design-token tones. No raw colors anywhere in definitions. */
export const TONES = ['default', 'accent', 'household', 'muted', 'danger'] as const;
export type Tone = (typeof TONES)[number];

/** Spacing scale allowed in definitions (gap, padding). */
export const SPACING = [0, 4, 8, 12, 16, 24] as const;

/**
 * The closed primitive vocabulary rendered by the interpreter (notes section 7.1).
 * `Embed` renders an array of nested instances `{component, props}` (used by the Card / Stack
 * built-ins to hold other catalog components); it obeys the same depth and cycle limits.
 */
export const PRIMITIVES = [
  'Stack',
  'Grid',
  'Card',
  'Section',
  'Text',
  'Heading',
  'Stat',
  'Badge',
  'Icon',
  'Progress',
  'Chart',
  'Image',
  'Divider',
  'Spacer',
  'Pressable',
  'Button',
  'Segmented',
  'Checkbox',
  'List',
  'Embed',
] as const;
export type PrimitiveName = (typeof PRIMITIVES)[number];

/**
 * One node of a definition. `t` is a primitive or the name of another registered component
 * (composition). Every other string field may contain bindings: `{{prop}}`, `{{a.b}}`,
 * `{{item.x}}`, `{{index}}`, `{{state.key}}`, with filters `{{x|money}}` (money, percent, date,
 * upper, round). A field that is exactly one binding keeps the bound value's type.
 */
export type DefNode = {
  t: string;
  /** Render only when the binding is truthy. */
  if?: string;
  children?: string[];
  [field: string]: unknown;
};

/** An action reference on Pressable / Button / Checkbox / Segmented nodes. */
export type ActionRef = { name: string; payload?: Record<string, unknown> };

export type ComponentDefinition = {
  name: string;
  version: number;
  description: string;
  /** Root must be `type: "object"`. */
  props: PropSchema;
  root: string;
  nodes: Record<string, DefNode>;
  /** Declared action names (<= 8). Nodes may only reference these. */
  actions?: string[];
  /** Force-replace an existing definition with the same or lower version. */
  replace?: boolean;
};

/** A built-in drawn by React code (charts, MoneyGlance) instead of the interpreter. */
export type CodeComponentMeta = {
  name: string;
  description: string;
  props: PropSchema;
};

/** One entry of the component registry. */
export type RegistryEntry = {
  name: string;
  version: number;
  description: string;
  props: PropSchema;
  builtin: boolean;
  /** Present for interpreter-rendered components; absent for code built-ins. */
  definition?: ComponentDefinition;
  /** catalogVersion at which this entry last changed (drives the [catalog-update] delta). */
  changedAt: number;
};

/** A component instance as emitted in an `ano-ui` fence. */
export type RenderInstance = { component: string; props: JsonObject };

/**
 * Tool-call args of `render_<Name>` / `define_component`. On a fence that could not be used
 * (bad JSON, oversize, invalid props, unclosed at the end of the run) the args are
 * `{ __fallback: <raw fence body>, __error: <short reason> }` and the slot draws that raw text in
 * a quiet card instead of the component.
 */
export type FallbackArgs = { __fallback: string; __error: string };

export function isFallbackArgs(args: unknown): args is FallbackArgs {
  return !!args && typeof args === 'object' && '__fallback' in args && typeof args.__fallback === 'string';
}

/** A user interaction inside a rendered component. `instanceId` is the AG-UI tool call id. */
export type UiAction = {
  component: string;
  instanceId: string;
  /** A name declared in the definition's `actions` (or a code built-in's fixed action). */
  name: string;
  payload: Record<string, JsonValue>;
};
export type UiActionHandler = (action: UiAction) => void;

/** Lifecycle of a tool-call render (mirrors CopilotKit's ToolCallStatus). */
export type RenderStatus = 'inProgress' | 'executing' | 'complete';

/** Props every code built-in component receives. */
export type CodeComponentProps = {
  props: Record<string, unknown>;
  instanceId: string;
  onAction: UiActionHandler;
};

/** Points accepted by the Chart primitive and the chart built-ins. */
export type ChartPoint = { label?: string; value: number };
export type ChartProps = {
  kind: 'line' | 'area' | 'bar';
  series: Array<number | ChartPoint>;
  /** Dashed horizontal reference line (budget). */
  budgetLine?: number;
  height?: number;
  tone?: Tone;
  format?: 'money' | 'percent' | 'number';
};
