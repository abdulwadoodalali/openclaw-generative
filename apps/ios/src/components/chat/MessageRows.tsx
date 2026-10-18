// One transcript row each for a user message and an assistant answer. The answer row carries the
// process line above it, and below it the pin receipt and, under the latest answer, the action bar.
// Long-press opens the same actions as a sheet (user: Copy, Edit).
import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Message, ToolMessage } from '@copilotkit/react-native/headless';
import type { AnswerProcess, PickedImage } from '../../state/AnoProvider';
import { colors } from '../../theme';
import { PinIcon, RefreshIcon } from '../CanvasIcons';
import { copyTextOf, MessageBubble } from '../MessageBubble';
import { Sheet } from '../Sheet';
import { tapMedium, tapSuccess } from './haptics';
import { CopyIcon, PencilIcon, ShareIcon, TextSelectIcon } from './icons';
import { ActionBar, MessageMenu, type MenuAction } from './MessageActions';
import { PinReceipt, usePin } from './pin';
import { ProcessLine } from './ProcessLine';

export type UserRowProps = {
  message: Message;
  images: PickedImage[];
  /** Puts the message text (and photos) back in the composer. */
  onEdit: (text: string, images: PickedImage[]) => void;
};

export function UserRow({ message, images, onEdit }: UserRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const text = copyTextOf(message);
  const actions: MenuAction[] = [
    {
      key: 'copy',
      label: 'Copy',
      icon: <CopyIcon size={20} color={colors.ink} />,
      onPress: () => {
        void Clipboard.setStringAsync(text).then(() => tapSuccess());
      },
    },
    { key: 'edit', label: 'Edit', icon: <PencilIcon size={20} color={colors.ink} />, onPress: () => onEdit(text, images) },
  ];
  return (
    <View>
      <MessageBubble
        message={message}
        images={images}
        onLongPress={() => {
          void tapMedium();
          setMenuOpen(true);
        }}
      />
      <MessageMenu visible={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} />
    </View>
  );
}

export type AssistantRowProps = {
  message: Message;
  streaming: boolean;
  /** The newest answer: it shows the action bar when it is done. */
  isLatest: boolean;
  toolResults: Map<string, ToolMessage>;
  process: AnswerProcess | null;
  threadTitle: string;
  prompt: string;
  sessionKey: string | null;
  onRetry: () => void;
};

export function AssistantRow({ message, streaming, isLatest, toolResults, process, threadTitle, prompt, sessionKey, onRetry }: AssistantRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const pin = usePin({ message, threadTitle, prompt, sessionKey });
  const text = copyTextOf(message);
  // Nothing to act on while nothing is drawn yet.
  const hasContent = text.length > 0 || pin.pinnable;
  const canPin = pin.pinnable && !pin.canvas;
  const canRetry = isLatest && !streaming;

  const actions: MenuAction[] = [
    {
      key: 'copy',
      label: 'Copy',
      icon: <CopyIcon size={20} color={colors.ink} />,
      onPress: () => {
        void Clipboard.setStringAsync(text).then(() => tapSuccess());
      },
    },
    ...(canRetry ? [{ key: 'retry', label: 'Try again', icon: <RefreshIcon size={20} color={colors.ink} />, onPress: onRetry }] : []),
    ...(canPin ? [{ key: 'pin', label: 'Pin as canvas', icon: <PinIcon size={20} color={colors.ink} />, onPress: pin.openSheet }] : []),
    { key: 'share', label: 'Share', icon: <ShareIcon size={20} color={colors.ink} />, onPress: () => void Share.share({ message: text }) },
    { key: 'select', label: 'Select text', icon: <TextSelectIcon size={20} color={colors.ink} />, onPress: () => setSelectOpen(true) },
  ];

  return (
    <View style={styles.row}>
      {process && !streaming ? <ProcessLine process={process} /> : null}
      <MessageBubble
        message={message}
        streaming={streaming}
        toolResults={toolResults}
        onLongPress={
          hasContent
            ? () => {
                void tapMedium();
                setMenuOpen(true);
              }
            : undefined
        }
      />
      {pin.canvas ? <PinReceipt title={pin.canvas.title} canvasId={pin.canvas.id} /> : null}
      {isLatest && !streaming && hasContent ? (
        <ActionBar text={text} onRetry={onRetry} onPin={canPin ? pin.openSheet : undefined} onMore={() => setMenuOpen(true)} />
      ) : null}
      <MessageMenu visible={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} />
      <Sheet visible={selectOpen} onClose={() => setSelectOpen(false)} label="Select text" maxHeightFraction={0.8}>
        <Text selectable style={styles.selectable}>
          {text}
        </Text>
      </Sheet>
      {pin.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 4 },
  selectable: { fontSize: 16, lineHeight: 24, color: colors.ink },
});
