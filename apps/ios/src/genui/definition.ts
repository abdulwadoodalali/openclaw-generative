// Validation of agent-authored component definitions (notes section 7.2). Pure TypeScript.
//
// Everything a model can send is untrusted data: `validateDefinition` checks structure and limits,
// `compilePropSchema` turns the JSON-schema subset into a Zod schema used to validate instances.
import { z, type ZodTypeAny } from 'zod';
import {
  COMPONENT_NAME_RE,
  LIMITS,
  PRIMITIVES,
  TONES,
  type ComponentDefinition,
  type DefNode,
  type PropSchema,
  type RegistryEntry,
} from './types.ts';

const PROP_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'] as const;
const ACTION_NODE_TYPES: ReadonlySet<string> = new Set(['Pressable', 'Button', 'Checkbox', 'Segmented']);
const ACTION_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_ENUM_VALUES = 32;
const MAX_DESCRIPTION_CHARS = 200;

const PropSchemaZ: z.ZodType<PropSchema> = z.lazy(() =>
  z.object({
    type: z.enum(PROP_TYPES),
    description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    enum: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .max(MAX_ENUM_VALUES)
      .optional(),
    items: PropSchemaZ.optional(),
    properties: z.record(PropSchemaZ).optional(),
    required: z.array(z.string()).optional(),
  }),
);

// Node fields beyond t / if / children are primitive props and are checked by the interpreter, so the
// node schema keeps unknown keys.
const DefNodeZ = z
  .object({
    t: z.string().min(1),
    if: z.string().optional(),
    children: z.array(z.string()).optional(),
  })
  .passthrough();

export const DefinitionSchema = z.object({
  name: z.string(),
  version: z.number().int().min(1),
  description: z.string().min(1).max(MAX_DESCRIPTION_CHARS),
  props: PropSchemaZ,
  root: z.string().min(1),
  nodes: z.record(DefNodeZ),
  actions: z.array(z.string()).optional(),
  replace: z.boolean().optional(),
});

export type ValidateDefinitionResult = { ok: true; definition: ComponentDefinition } | { ok: false; error: string };

/** UTF-8 byte length without allocating (TextEncoder/Buffer availability differs per runtime). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** One short human sentence for the first problem of a Zod failure. */
export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid value';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Compiles the PropSchema subset to Zod.
 * - Depth: the root object is depth 0; only object and array nodes have a depth and it may not
 *   exceed LIMITS.maxSchemaDepth. Scalar leaves are exempt.
 * - Objects are passthrough: unknown keys are kept, never stripped, so nested instance props
 *   (`{component, props}`) survive. `{type:"object"}` without `properties` accepts any JSON object.
 * - Properties not listed in `required` are optional.
 * - `string` accepts a finite number and coerces it to its string form; enums stay strict.
 * Throws an Error with a short message when the schema itself is malformed or too deep.
 */
export function compilePropSchema(schema: PropSchema): ZodTypeAny {
  return compileNode(schema, 0, 'props');
}

function compileNode(schema: PropSchema, depth: number, path: string): ZodTypeAny {
  const { type } = schema;
  if (type === 'array' || type === 'object') {
    if (depth > LIMITS.maxSchemaDepth) {
      throw new Error(`${path}: schema nests deeper than ${LIMITS.maxSchemaDepth} levels`);
    }
  }
  if (schema.enum && type !== 'string' && type !== 'number' && type !== 'integer') {
    throw new Error(`${path}: enum is only allowed on string, number or integer`);
  }
  switch (type) {
    case 'string': {
      if (schema.enum) {
        const allowed = schema.enum.map((value) => {
          if (typeof value !== 'string') throw new Error(`${path}: enum values must be strings`);
          return value;
        });
        return z.string().refine((value) => allowed.includes(value), `must be one of ${allowed.join(', ')}`);
      }
      return z.preprocess((value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : value), z.string());
    }
    case 'number':
    case 'integer': {
      const base = type === 'integer' ? z.number().int() : z.number();
      if (!schema.enum) return base;
      const allowed = schema.enum.map((value) => {
        if (typeof value !== 'number') throw new Error(`${path}: enum values must be numbers`);
        return value;
      });
      return base.refine((value) => allowed.includes(value), `must be one of ${allowed.join(', ')}`);
    }
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(schema.items ? compileNode(schema.items, depth + 1, `${path}[]`) : z.unknown());
    case 'object': {
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      for (const key of required) {
        if (!(key in properties)) throw new Error(`${path}: required "${key}" is not a declared property`);
      }
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, child] of Object.entries(properties)) {
        const compiled = compileNode(child, depth + 1, `${path}.${key}`);
        shape[key] = required.has(key) ? compiled : compiled.optional();
      }
      return z.object(shape).passthrough();
    }
  }
}

/** Ids of the nodes a node renders: `children` and (List) `template`. Returns an error string on bad shapes. */
function childIds(id: string, node: DefNode): string[] | string {
  const ids: string[] = [];
  if (node.children !== undefined) {
    if (!Array.isArray(node.children) || !node.children.every((child) => typeof child === 'string')) {
      return `node "${id}": children must be a list of node ids`;
    }
    ids.push(...node.children);
  }
  if (node.template !== undefined) {
    if (typeof node.template !== 'string') return `node "${id}": template must be a node id`;
    ids.push(node.template);
  }
  return ids;
}

function checkNodeFields(id: string, node: DefNode, actions: ReadonlySet<string>): string | null {
  if (typeof node.tone === 'string' && !node.tone.includes('{{') && !(TONES as readonly string[]).includes(node.tone)) {
    return `node "${id}": tone "${node.tone}" is not one of ${TONES.join(', ')}`;
  }
  if (node.t === 'Image') {
    if (typeof node.uri !== 'string') return `node "${id}": Image needs a uri`;
    if (!node.uri.includes('{{') && !node.uri.startsWith('https://')) return `node "${id}": Image uri must be https`;
  }
  if (ACTION_NODE_TYPES.has(node.t) && node.action !== undefined) {
    const action = node.action;
    if (typeof action !== 'object' || action === null || !('name' in action) || typeof action.name !== 'string') {
      return `node "${id}": action must be {"name": "..."}`;
    }
    if (!actions.has(action.name)) return `node "${id}": action "${action.name}" is not listed in actions`;
  }
  return null;
}

/** Walks components used by `definition` (not primitives) looking for `target`. */
function usesComponent(
  definition: ComponentDefinition,
  target: string,
  resolve: (name: string) => RegistryEntry | undefined,
  seen: Set<string>,
): boolean {
  for (const node of Object.values(definition.nodes)) {
    if ((PRIMITIVES as readonly string[]).includes(node.t) || seen.has(node.t)) continue;
    if (node.t === target) return true;
    seen.add(node.t);
    const nested = resolve(node.t)?.definition;
    if (nested && usesComponent(nested, target, resolve, seen)) return true;
  }
  return false;
}

/**
 * Validates an untrusted definition: shape, limits, node graph, actions, tones, image URLs and
 * composition. `resolve` looks up already registered components (nodes whose `t` is not a primitive).
 * A `t` that is a primitive name is always the primitive, never a registry reference.
 */
export function validateDefinition(input: unknown, resolve: (name: string) => RegistryEntry | undefined): ValidateDefinitionResult {
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return fail('definition is not valid JSON data');
  }
  if (typeof json !== 'string') return fail('definition is not valid JSON data');
  if (utf8Bytes(json) > LIMITS.maxDefinitionBytes) {
    return fail(`definition is larger than ${LIMITS.maxDefinitionBytes / 1024} KB`);
  }

  const parsed = DefinitionSchema.safeParse(input);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const definition: ComponentDefinition = parsed.data;

  if (!COMPONENT_NAME_RE.test(definition.name)) {
    return fail('name must be letters and digits only, starting with a letter (max 64)');
  }
  if (definition.props.type !== 'object') return fail('props must be an object schema (type "object")');
  try {
    compilePropSchema(definition.props);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'invalid props schema');
  }

  const actionNames = definition.actions ?? [];
  if (actionNames.length > LIMITS.maxActions) return fail(`at most ${LIMITS.maxActions} actions`);
  if (!actionNames.every((name) => ACTION_NAME_RE.test(name))) return fail('action names must be letters, digits or underscore');
  const actions = new Set(actionNames);

  const nodeIds = Object.keys(definition.nodes);
  if (nodeIds.length > LIMITS.maxNodes) return fail(`at most ${LIMITS.maxNodes} nodes`);
  if (!(definition.root in definition.nodes)) return fail(`root "${definition.root}" is not a node`);

  const used = new Set<string>();
  for (const [id, node] of Object.entries(definition.nodes)) {
    const ids = childIds(id, node);
    if (typeof ids === 'string') return fail(ids);
    const missing = ids.find((child) => !(child in definition.nodes));
    if (missing !== undefined) return fail(`node "${id}" refers to missing node "${missing}"`);
    const fieldError = checkNodeFields(id, node, actions);
    if (fieldError) return fail(fieldError);
    if (!(PRIMITIVES as readonly string[]).includes(node.t)) used.add(node.t);
  }

  // Each node may be rendered from exactly one place: this also rules out cycles.
  const visited = new Set<string>();
  const walk = (id: string, depth: number): string | null => {
    if (depth > LIMITS.maxDepth) return `nesting is deeper than ${LIMITS.maxDepth} levels`;
    if (visited.has(id)) return `node "${id}" is used more than once or forms a cycle`;
    visited.add(id);
    const ids = childIds(id, definition.nodes[id]);
    if (typeof ids === 'string') return ids;
    for (const child of ids) {
      const problem = walk(child, depth + 1);
      if (problem) return problem;
    }
    return null;
  };
  const structureError = walk(definition.root, 1);
  if (structureError) return fail(structureError);

  for (const name of used) {
    if (name === definition.name) return fail(`"${name}" cannot use itself`);
    const entry = resolve(name);
    if (!entry) return fail(`node uses unknown component "${name}"; define it first`);
    if (entry.definition && usesComponent(entry.definition, definition.name, resolve, new Set([name]))) {
      return fail(`"${definition.name}" and "${name}" would use each other`);
    }
  }

  return { ok: true, definition };
}
