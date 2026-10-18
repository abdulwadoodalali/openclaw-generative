// Chat's view of `canvas_update` tool calls (an ```ano-canvas fence). Op "create" makes the canvas,
// once per tool call, and shows a compact "Saved canvas" chip with an Open button. An update with
// {"canvas":"home"} changes your Home in place, once per tool call, and shows a receipt with Undo
// and View. Any other edit only means something inside a canvas's own session (the canvas runner
// applies those), so in chat it draws nothing. Mounted once next to <GenUiRegistrar /> (src/app/_layout.tsx).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { z } from 'zod';
import { useRenderTool } from '@copilotkit/react-native/headless';
import { PinIcon } from '../components/CanvasIcons';
import { CANVAS_TOOL_NAME, isFallbackArgs } from '../genui/types.ts';
import { promptBeforeToolCall } from '../lib/chatOrigin';
import { getLinkedCanvasId, linkCanvas, useLinkedCanvasId } from '../lib/canvasLinks';
import { useCanvas } from '../screens/useCanvases';
import { useAno, useChat } from '../state/AnoProvider';
import { colors, radii, shadows } from '../theme';
import { canvasStore } from './instance';
import { HOME_CANVAS_ID, parseCanvasUpdate, updateKey, type CanvasUpdate } from './protocol.ts';
import { showHome } from '../lib/pager';

const PermissiveParams = z.object({}).passthrough();

/**
 * The link key of a chat canvas update. It is derived from the update itself, not the tool call id:
 * a reloaded chat gets new tool call ids, and an id-based key re-created canvases and re-applied
 * Home changes on every reload. (Message pins use the message id, which can never collide.)
 */
const updateLinkKey = (update: CanvasUpdate) => `tool:${updateKey(update)}`;

export function CanvasToolRenderer() {
  useRenderTool(
    {
      name: CANVAS_TOOL_NAME,
      parameters: PermissiveParams,
      render: ({ parameters, toolCallId }) => <CanvasCreateChip parameters={parameters} toolCallId={toolCallId} />,
    },
    [],
  );
  return null;
}

function CanvasCreateChip({ parameters, toolCallId }: { parameters: Record<string, unknown>; toolCallId: string }) {
  // Empty args: the fence is still streaming in, nothing to show yet.
  if (Object.keys(parameters).length === 0) return null;
  const parsed = parseCanvasUpdate(parameters);
  if (!parsed.ok) {
    return isFallbackArgs(parameters) || parameters.op === 'create' ? <Note text={`Could not save a canvas: ${parsed.error}`} /> : null;
  }
  if (parsed.update.op !== 'create') {
    return parsed.update.canvas === HOME_CANVAS_ID ? <UpdatedHome update={parsed.update} /> : null;
  }
  return <CreatedCanvas update={parsed.update} toolCallId={toolCallId} />;
}

function CreatedCanvas({ update, toolCallId }: { update: CanvasUpdate; toolCallId: string }) {
  const linkKey = updateLinkKey(update);
  const linked = useLinkedCanvasId(linkKey);
  const canvas = useCanvas(linked);
  const { messages, isRunning } = useChat();
  const { threads } = useAno();
  // Read at creation time only: the creation must not re-run as the thread grows.
  const thread = useRef({ messages, sessionKey: threads.activeKey });
  thread.current = { messages, sessionKey: threads.activeKey };
  // Only a reply streaming right now may create: replaying history must never change anything.
  const live = useRef(isRunning).current;

  useEffect(() => {
    if (!live || getLinkedCanvasId(linkKey) !== undefined) return;
    // A canvas Ano makes starts locked, and remembers the question it answers so a refresh can re-ask it.
    const prompt = promptBeforeToolCall(thread.current.messages, toolCallId);
    const created = canvasStore.create({
      title: update.title ?? 'Canvas',
      blocks: update.blocks ?? [],
      by: 'ano',
      scope: update.scope,
      pinned: update.pin ?? false,
      summary: update.summary,
      locked: true,
      origin: prompt ? { prompt, sessionKey: thread.current.sessionKey ?? undefined, at: Date.now() } : undefined,
    });
    linkCanvas(linkKey, created.id);
  }, [linkKey, toolCallId, update, live]);

  if (linked !== undefined && !canvas && canvasStore.get(linked) === undefined) {
    // Linked earlier, since deleted: say so rather than silently creating it again.
    return <Note text={`Canvas removed \u00B7 ${update.title ?? 'Canvas'}`} />;
  }
  if (linked === undefined && !live) return <Note text={`Earlier: saved a canvas \u00B7 ${update.title ?? 'Canvas'}`} />;
  const title = canvas?.title ?? update.title ?? 'Canvas';
  return (
    <View style={styles.chip}>
      <View style={styles.icon}>
        <PinIcon size={14} color={colors.white} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {`Saved canvas \u00B7 ${title}`}
      </Text>
      <Pressable
        onPress={() => canvas && router.push({ pathname: '/canvas/[id]', params: { id: canvas.id } })}
        disabled={!canvas}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`Open canvas ${title}`}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <Text style={styles.openLabel}>Open</Text>
      </Pressable>
    </View>
  );
}

/** Applies a chat's change to Home once, while the reply streams, and offers Undo / View. */
function UpdatedHome({ update }: { update: CanvasUpdate }) {
  const linkKey = updateLinkKey(update);
  const linked = useLinkedCanvasId(linkKey);
  const home = useCanvas(HOME_CANVAS_ID);
  const [error, setError] = useState<string | null>(null);
  // Only a reply streaming right now may change Home: replaying history must never change anything.
  const live = useRef(useChat().isRunning).current;

  useEffect(() => {
    if (!live || getLinkedCanvasId(linkKey) !== undefined) return;
    const result = canvasStore.applyUpdate(HOME_CANVAS_ID, update, 'ano');
    if (!result.ok) {
      setError(result.error);
      return;
    }
    linkCanvas(linkKey, HOME_CANVAS_ID);
  }, [linkKey, update, live]);

  if (error) return <Note text={`Could not change your Home: ${error}`} />;
  if (linked === undefined && !live) return <Note text={`Earlier: changed your Home${update.summary ? ` \u00B7 ${update.summary}` : ''}`} />;
  if (linked === undefined || !home) return null;
  return (
    <View style={styles.chip}>
      <View style={styles.icon}>
        <PinIcon size={14} color={colors.white} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {update.summary || 'Updated your Home'}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={() => canvasStore.undo(HOME_CANVAS_ID)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Undo the change to your Home"
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryLabel}>Undo</Text>
        </Pressable>
        <Pressable
          onPress={showHome}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="View your Home"
          style={({ pressed }) => [styles.open, pressed && styles.pressed]}
        >
          <Text style={styles.openLabel}>View</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View style={styles.note} accessibilityRole="text">
      <Text style={styles.noteText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: radii.group,
    backgroundColor: colors.white,
    ...shadows.button,
  },
  icon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.ink },
  open: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  openLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.accentText },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  secondary: { height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.inkSecondary },
  pressed: { opacity: 0.7 },
  note: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.chip, backgroundColor: colors.fill },
  noteText: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
});
