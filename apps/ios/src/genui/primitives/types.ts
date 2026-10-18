// What DynamicComponent hands to every primitive. Pure types.
import type { ReactNode } from 'react';
import type { JsonObject } from '../types.ts';

export type PrimitiveContext = {
  /**
   * Turns a resolved `action` field into a press handler. Undefined when the field is not a valid
   * `{name, payload}` or the name is not declared by the definition. `extra` is merged into the
   * payload (Checkbox and Segmented add `value`).
   */
  actionHandler: (action: unknown) => ((extra?: JsonObject) => void) | undefined;
  /** Local view state (`{{state.<key>}}`), including defaults for Segmented binds. */
  state: Record<string, unknown>;
  setState: (key: string, value: unknown) => void;
  /** List: renders the template node for one item. */
  renderTemplate: (item: unknown, index: number) => ReactNode;
  /** Embed: renders an array of `{component, props}` instances. */
  renderInstances: (items: unknown) => ReactNode[];
};

export type PrimitiveProps = {
  /** Node fields with bindings already resolved. Untrusted: read through ./coerce.ts. */
  fields: Record<string, unknown>;
  ctx: PrimitiveContext;
  /** Rendered `children` nodes, in order. */
  children?: ReactNode[];
};
