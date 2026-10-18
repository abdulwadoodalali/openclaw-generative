// "Pin as canvas" from chat: the cards of an answer become a canvas (new, or added to one you have)
// through the existing PinSheet. After pinning, a receipt chip under the answer says where it went.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import type { Message } from '@copilotkit/react-native/headless';
import { isPlainObject, type CanvasBlock } from '../../canvas/types';
import { isFallbackArgs, RENDER_TOOL_PREFIX } from '../../genui/types.ts';
import { linkCanvas, useLinkedCanvasId } from '../../lib/canvasLinks';
import { useCanvas } from '../../screens/useCanvases';
import { colors, type } from '../../theme';
import { CheckIcon } from '../CanvasIcons';
import { PinSheet } from '../PinSheet';

/** The components of a message as canvas blocks, in order. Calls that did not parse are skipped. */
export function blocksOfMessage(message: Message): CanvasBlock[] {
  if (message.role !== 'assistant') return [];
  const blocks: CanvasBlock[] = [];
  for (const call of message.toolCalls ?? []) {
    const { name, arguments: raw } = call.function;
    if (!name.startsWith(RENDER_TOOL_PREFIX) || !raw) continue;
    let args: unknown;
    try {
      args = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isPlainObject(args) || isFallbackArgs(args)) continue;
    blocks.push({ component: name.slice(RENDER_TOOL_PREFIX.length), props: args });
  }
  return blocks;
}

/** A readable name for a canvas made from these blocks: the first card's title or month, else the fallback. */
export function canvasTitleFor(blocks: readonly CanvasBlock[], fallback: string): string {
  for (const b of blocks) {
    for (const key of ['title', 'month']) {
      const value = b.props[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback.trim() || 'Canvas';
}

export type PinTarget = {
  message: Message;
  /** Used as the canvas title when no component carries one. */
  threadTitle: string;
  /** The user message before this answer, saved as the canvas's origin question. */
  prompt: string;
  sessionKey: string | null;
};

/** Pin state for one answer: whether it has cards, the canvas it was pinned to, and the sheet. */
export function usePin({ message, threadTitle, prompt, sessionKey }: PinTarget) {
  const blocks = useMemo(() => blocksOfMessage(message), [message]);
  const linkedId = useLinkedCanvasId(message.id);
  const canvas = useCanvas(linkedId);
  const [open, setOpen] = useState(false);

  const sheet = (
    <PinSheet
      visible={open}
      blocks={blocks}
      defaultTitle={canvasTitleFor(blocks, threadTitle)}
      prompt={prompt}
      sessionKey={sessionKey}
      onClose={() => setOpen(false)}
      onPinned={(pinned) => linkCanvas(message.id, pinned.id)}
    />
  );

  return { pinnable: blocks.length > 0, canvas, openSheet: () => setOpen(true), sheet };
}

/** "Pinned to Open tasks · Open": under the answer once it is pinned. */
export function PinReceipt({ title, canvasId }: { title: string; canvasId: string }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/canvas/[id]', params: { id: canvasId } })}
      accessibilityRole="button"
      accessibilityLabel={`Pinned to ${title}. Open canvas`}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <CheckIcon size={14} color={colors.householdText} />
      <Text style={styles.label} numberOfLines={1}>
        {`Pinned to ${title} \u00B7 Open`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.householdTint,
  },
  label: { flexShrink: 1, ...type.secondary, fontWeight: '600', color: colors.householdText },
  pressed: { opacity: 0.75 },
});
