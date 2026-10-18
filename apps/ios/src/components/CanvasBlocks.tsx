// Draws a canvas's blocks in order through the same renderer as chat (GenUiToolCall), with taps
// inside the components forwarded to the canvas's edit session: a Suggestions chip is a normal
// edit request, every other tap a `[ui-event]` turn (the same rules as chat). On a locked canvas
// `onLockedTap` takes the taps instead, with the block they came from, and nothing edits the canvas.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { UiActionProvider, createChatUiActionHandler, type UiActionTarget } from '../genui/actions';
import { GenUiToolCall } from '../genui/GenUiToolCall';
import type { UiAction, UiActionHandler } from '../genui/types.ts';
import type { CanvasBlock } from '../canvas/types';

export type CanvasBlocksProps = {
  canvasId: string;
  blocks: readonly CanvasBlock[];
  /** The `send` and `sendUiEvent` of the canvas editor the blocks belong to. */
  editor: UiActionTarget;
  /** Set on a locked canvas: gets every tap together with the block it happened in. */
  onLockedTap?: (block: CanvasBlock, action: UiAction) => void;
  gap?: number;
};

export function CanvasBlocks({ canvasId, blocks, editor, onLockedTap, gap = 14 }: CanvasBlocksProps) {
  const { send, sendUiEvent } = editor;
  const handler = useMemo(() => createChatUiActionHandler({ send, sendUiEvent }), [send, sendUiEvent]);
  return (
    <View style={{ gap }}>
      {blocks.map((b, i) => (
        <UiActionProvider key={`${canvasId}:${i}`} handler={onLockedTap ? lockedHandler(b, onLockedTap) : handler}>
          <GenUiToolCall name={b.component} args={b.props} toolCallId={`${canvasId}:${i}`} pending={false} />
        </UiActionProvider>
      ))}
    </View>
  );
}

function lockedHandler(block: CanvasBlock, onLockedTap: (block: CanvasBlock, action: UiAction) => void): UiActionHandler {
  return (action) => onLockedTap(block, action);
}
