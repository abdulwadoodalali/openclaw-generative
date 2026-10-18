// Collapsible: a section header that expands to a list of nested components. Children are
// `{component, props}` instances drawn through the registry (the same resolution as a top-level
// `ano-ui` fence), so their taps still reach the UiActionProvider.
import React from 'react';
import type { CodeComponentProps } from '../types.ts';
import { useRenderNode } from '../nodeContext.tsx';
import { CollapsibleSection } from './CollapsibleSection.tsx';

export const COLLAPSIBLE_MAX_CHILDREN = 24;

type Child = { component: string; props: Record<string, unknown> };

function childrenOf(value: unknown): Child[] {
  if (!Array.isArray(value)) return [];
  const out: Child[] = [];
  for (const entry of value.slice(0, COLLAPSIBLE_MAX_CHILDREN)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { component, props } = entry as { component?: unknown; props?: unknown };
    if (typeof component !== 'string') continue;
    out.push({ component, props: typeof props === 'object' && props !== null && !Array.isArray(props) ? (props as Record<string, unknown>) : {} });
  }
  return out;
}

export function Collapsible({ props, instanceId }: CodeComponentProps) {
  const renderNode = useRenderNode();
  const title = typeof props.title === 'string' && props.title.trim() ? props.title.trim() : 'Details';
  const subtitle = typeof props.subtitle === 'string' && props.subtitle.trim() ? props.subtitle.trim() : undefined;
  const children = childrenOf(props.children);
  const count = `${children.length} ${children.length === 1 ? 'item' : 'items'}`;

  return (
    <CollapsibleSection title={title} subtitle={subtitle ?? count} defaultOpen={props.open === true}>
      {renderNode ? children.map((child, index) => renderNode(child.component, child.props, `${instanceId}.${index}`)) : null}
    </CollapsibleSection>
  );
}
