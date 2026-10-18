// Draws one `render_<Name>` tool call from the component registry. Shared by the CopilotKit
// renderers of the built-ins (GenUiRegistrar) and by ToolCallSlot, which handles components the
// agent defined at runtime (no renderer is registered for those names).
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Animated, Platform } from 'react-native';
import { z } from 'zod';
import { useUiActionHandler } from './actions';
import { CODE_COMPONENTS, GenUiFallback, GenUiSkeleton } from './components';
import { DynamicComponent, type ResolvedComponent } from './DynamicComponent';
import { NodeRendererProvider, type RenderNode } from './nodeContext';
import { genuiRegistry } from './registryInstance';
import { LIMITS, isFallbackArgs } from './types.ts';

/** How a registered component is drawn: its definition through the interpreter, or its React code. */
export function resolveComponent(name: string): ResolvedComponent | undefined {
  const entry = genuiRegistry.get(name);
  if (!entry) return undefined;
  if (entry.definition) return { kind: 'definition', definition: entry.definition };
  const Component = CODE_COMPONENTS[name];
  return Component ? { kind: 'code', Component } : undefined;
}

const PropsSchema = z.record(z.string(), z.unknown());

function subscribeCatalog(listener: () => void): () => void {
  return genuiRegistry.subscribe(listener);
}

function catalogSnapshot(): number {
  return genuiRegistry.catalogVersion;
}

export type GenUiToolCallProps = {
  /** Component name without the `render_` prefix. */
  name: string;
  /** Parsed tool call arguments: the component props, or FallbackArgs. */
  args: unknown;
  /** AG-UI tool call id, the instance id of the component. */
  toolCallId: string;
  /** The args are still streaming in (or the call has none yet): draw a skeleton. */
  pending: boolean;
};

/** How deep nested instances (Collapsible children, generic card nodes) already sit. */
const NestingContext = createContext(0);

export function GenUiToolCall(props: GenUiToolCallProps) {
  const depth = useContext(NestingContext);
  // Instances nested inside this one resolve through the same registry, one level deeper.
  const renderNode = useCallback<RenderNode>(
    (component, nodeProps, id) =>
      depth >= LIMITS.maxDepth ? (
        <GenUiFallback key={id} name={component} error="Nested too deeply" />
      ) : (
        <GenUiToolCall key={id} name={component} args={nodeProps} toolCallId={id} pending={false} />
      ),
    [depth],
  );
  return (
    <NestingContext.Provider value={depth + 1}>
      <NodeRendererProvider value={renderNode}>
        <ToolCallBody {...props} />
      </NodeRendererProvider>
    </NestingContext.Provider>
  );
}

/** A component whose props just finished streaming fades in and lifts 6pt over 220ms (replacing its skeleton). */
function useResolveIn(pending: boolean) {
  const wasPending = useRef(pending);
  const progress = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    if (!pending && wasPending.current) {
      progress.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start();
    }
    wasPending.current = pending;
  }, [pending, progress]);
  return { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] };
}

function ToolCallBody({ name, args, toolCallId, pending }: GenUiToolCallProps) {
  // Re-render when a definition lands: a component defined after its first use starts drawing.
  useSyncExternalStore(subscribeCatalog, catalogSnapshot, catalogSnapshot);
  const onAction = useUiActionHandler();
  const resolveIn = useResolveIn(pending);
  const props = useMemo(() => {
    const parsed = PropsSchema.safeParse(args);
    return parsed.success ? parsed.data : {};
  }, [args]);

  if (isFallbackArgs(args)) return <GenUiFallback name={name} raw={args.__fallback} error={args.__error} />;
  const resolved = resolveComponent(name);
  if (!resolved) {
    return pending ? <GenUiSkeleton name={name} /> : <GenUiFallback name={name} props={props} error="unknown component" />;
  }
  if (pending) return <GenUiSkeleton name={name} />;
  if (resolved.kind === 'code') {
    const Code = resolved.Component;
    return (
      <Animated.View style={resolveIn}>
        <Code props={props} instanceId={toolCallId} onAction={onAction} />
      </Animated.View>
    );
  }
  return (
    <Animated.View style={resolveIn}>
      <DynamicComponent definition={resolved.definition} props={props} instanceId={toolCallId} onAction={onAction} resolve={resolveComponent} />
    </Animated.View>
  );
}
