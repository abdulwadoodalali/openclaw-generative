// The interpreter: renders a ComponentDefinition (data, never code) from the closed primitive
// vocabulary. It walks `nodes` from `root`, resolves `{{bindings}}` per field, honors `if`, renders
// other catalog components by name, and only forwards actions the definition declared.
//
// Safety budget, all deterministic (a pure function of the definition and the props):
//   - instance depth <= LIMITS.maxDepth (composition and Embed nest DynamicComponents)
//   - node depth <= LIMITS.maxDepth inside one definition, and a node never renders inside itself
//   - lists and embeds render at most MAX_LIST_ITEMS entries
//   - every instance gets a node budget that is divided among children, template rows and nested
//     instances, so a hostile definition (a list nested in a list over the same array) is cut off
//     instead of multiplying
import * as React from 'react';
import { z } from 'zod';
import { isTruthyBinding, resolveTemplate, type BindingScope } from './bindings.ts';
import { GenUiFallback } from './components';
import { PRIMITIVE_COMPONENTS, isPrimitiveName } from './primitives';
import { MAX_LIST_ITEMS } from './primitives/layout.tsx';
import { asString, STATE_KEY_RE, toJsonObject } from './primitives/coerce.ts';
import type { PrimitiveContext } from './primitives/types.ts';
import { LIMITS, type CodeComponentProps, type ComponentDefinition, type DefNode, type UiActionHandler } from './types.ts';

export type ResolvedComponent =
  | { kind: 'definition'; definition: ComponentDefinition }
  | { kind: 'code'; Component: React.ComponentType<CodeComponentProps> };

export type DynamicComponentProps = {
  definition: ComponentDefinition;
  /** The instance's props (what the assistant emitted). */
  props: Record<string, unknown>;
  /** AG-UI tool call id of the outermost instance; nested instances share it. */
  instanceId: string;
  onAction: UiActionHandler;
  /** Looks a component up by name (registry). */
  resolve: (name: string) => ResolvedComponent | undefined;
  /** Nesting level of this instance; callers start at 0 (the default). */
  depth?: number;
  /** Node budget for this instance; set by the interpreter for nested instances. */
  budget?: number;
};

const ROOT_NODE_BUDGET = 1500;
/** Node fields that structure the tree and are never passed to a primitive as data. */
const STRUCTURAL_FIELD_RE = /^(t|if|children|template|__proto__)$/;

const InstanceSchema = z.object({
  component: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
});

function resolveFields(node: DefNode, scope: BindingScope): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!STRUCTURAL_FIELD_RE.test(key)) fields[key] = resolveTemplate(value, scope);
  }
  return fields;
}

/** Segmented controls start on their first option so `{{state.<bind>}}` is readable immediately. */
function defaultState(definition: ComponentDefinition, props: Record<string, unknown>): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const scope: BindingScope = { props, state: {} };
  for (const node of Object.values(definition.nodes)) {
    if (node.t !== 'Segmented' || typeof node.bind !== 'string' || !STATE_KEY_RE.test(node.bind)) continue;
    if (Object.prototype.hasOwnProperty.call(state, node.bind)) continue;
    const options = resolveTemplate(node.options, scope);
    const first = Array.isArray(options) ? asString(options[0]) : undefined;
    if (first !== undefined) state[node.bind] = first;
  }
  return state;
}

function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

type BoundaryProps = { name: string; resetKeys: readonly unknown[]; children: React.ReactNode };

/** A render error in one instance becomes a quiet fallback card; the rest of the chat is untouched. */
class RenderBoundary extends React.Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return <GenUiFallback name={this.props.name} error={this.state.error.message} />;
    return this.props.children;
  }
}

export function DynamicComponent(props: DynamicComponentProps) {
  return (
    <RenderBoundary name={props.definition.name} resetKeys={[props.definition, props.props]}>
      <Interpreter {...props} />
    </RenderBoundary>
  );
}

function Interpreter({
  definition,
  props: instanceProps,
  instanceId,
  onAction,
  resolve,
  depth = 0,
  budget = ROOT_NODE_BUDGET,
}: DynamicComponentProps) {
  const [picked, setPicked] = React.useState<Record<string, unknown>>({});
  const defaults = React.useMemo(() => defaultState(definition, instanceProps), [definition, instanceProps]);
  const state = React.useMemo(() => ({ ...defaults, ...picked }), [defaults, picked]);
  const setState = React.useCallback((key: string, value: unknown) => {
    if (STATE_KEY_RE.test(key)) setPicked((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (depth > LIMITS.maxDepth) return <GenUiFallback name={definition.name} error="Nested too deeply" />;

  const declared = definition.actions ?? [];

  const actionHandler: PrimitiveContext['actionHandler'] = (action) => {
    if (action === null || typeof action !== 'object' || !('name' in action) || typeof action.name !== 'string') return undefined;
    const name = action.name;
    if (!declared.includes(name)) return undefined;
    const payload = 'payload' in action ? toJsonObject(action.payload) : {};
    return (extra) => onAction({ component: definition.name, instanceId, name, payload: { ...payload, ...extra } });
  };

  /** A catalog component by name: code built-in, or another definition one level deeper. */
  const renderResolved = (name: string, componentProps: Record<string, unknown>, key: string, nodeBudget: number): React.ReactNode => {
    const target = resolve(name);
    if (!target) return <GenUiFallback key={key} name={name} props={componentProps} error="unknown component" />;
    if (target.kind === 'code') {
      const Code = target.Component;
      return <Code key={key} props={componentProps} instanceId={instanceId} onAction={onAction} />;
    }
    return (
      <DynamicComponent
        key={key}
        definition={target.definition}
        props={componentProps}
        instanceId={instanceId}
        onAction={onAction}
        resolve={resolve}
        depth={depth + 1}
        budget={nodeBudget}
      />
    );
  };

  const renderNode = (
    id: string,
    scope: BindingScope,
    ancestry: readonly string[],
    key: string,
    nodeBudget: number,
  ): React.ReactNode => {
    const node = Object.prototype.hasOwnProperty.call(definition.nodes, id) ? definition.nodes[id] : undefined;
    if (!node || nodeBudget < 1 || ancestry.includes(id) || ancestry.length >= LIMITS.maxDepth) return null;
    if (node.if !== undefined && !(typeof node.if === 'string' ? isTruthyBinding(node.if, scope) : Boolean(node.if))) return null;

    const fields = resolveFields(node, scope);
    const path = [...ancestry, id];
    const inner = nodeBudget - 1;

    if (!isPrimitiveName(node.t)) return renderResolved(node.t, fields, key, inner);

    const childIds = Array.isArray(node.children) ? node.children.filter((child): child is string => typeof child === 'string') : [];
    const childBudget = Math.floor(inner / Math.max(1, childIds.length));
    const rowCount = Array.isArray(fields.items) ? Math.min(fields.items.length, MAX_LIST_ITEMS) : 1;
    const rowBudget = Math.floor(inner / Math.max(1, rowCount));

    const ctx: PrimitiveContext = {
      actionHandler,
      state,
      setState,
      renderTemplate: (item, index) =>
        typeof node.template === 'string' ? renderNode(node.template, { ...scope, item, index }, path, `row${index}`, rowBudget) : null,
      renderInstances: (raw) => {
        if (!Array.isArray(raw)) return [];
        const entries = raw.slice(0, MAX_LIST_ITEMS);
        const share = Math.floor(inner / Math.max(1, entries.length));
        return entries.map((entry, i) => {
          const parsed = InstanceSchema.safeParse(entry);
          return parsed.success ? (
            renderResolved(parsed.data.component, parsed.data.props, `inst${i}`, share)
          ) : (
            <GenUiFallback key={`inst${i}`} name="component" error="Not a component instance" />
          );
        });
      },
    };

    const Primitive = PRIMITIVE_COMPONENTS[node.t];
    return (
      <Primitive key={key} fields={fields} ctx={ctx}>
        {childIds.map((childId, i) => renderNode(childId, scope, path, `${i}`, childBudget))}
      </Primitive>
    );
  };

  return <>{renderNode(definition.root, { props: instanceProps, state }, [], 'root', budget)}</>;
}
