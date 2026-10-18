import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message, ToolCall, ToolMessage } from '@copilotkit/react-native/headless';
import { colors, radii, type } from '../theme';
import { cleanUserText } from '../genui/catalog.ts';
import { splitMarkers, stripMarkers } from '../genui/proseMarkers.ts';
import { stripPersona } from '../openclaw/text';
import type { PickedImage } from '../state/AnoProvider';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ToolCallSlot } from './ToolCallSlot';

export type MessageBubbleProps = {
  /** An AG-UI message from the OpenClawAgent. Only user and assistant messages are drawn. */
  message: Message;
  /** True while this is the assistant message being streamed. */
  streaming?: boolean;
  /** Tool results by tool call id (used by tool-call renderers in build 2). */
  toolResults?: Map<string, ToolMessage>;
  /** Photos the user attached to this message, drawn above the text of a user bubble. */
  images?: PickedImage[];
  /** Long-press on the bubble (user) or the answer (assistant). */
  onLongPress?: () => void;
};

function rawText(message: Message): string {
  const content = 'content' in message ? message.content : undefined;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part ? String(part.text ?? '') : ''))
    .join('');
}

/** What Copy puts on the clipboard: the visible text of a message, without hidden context or card markers. */
export function copyTextOf(message: Message): string {
  if (message.role === 'user') return cleanUserText(rawText(message)).text.trim();
  return stripMarkers(stripPersona(rawText(message))).trim();
}

export const MessageBubble = React.memo(function MessageBubble({ message, streaming = false, toolResults, images = [], onLongPress }: MessageBubbleProps) {
  if (message.role === 'user') {
    // Same cleaning as history rows, so a live message and its reload look the same (tap data hidden).
    const text = cleanUserText(rawText(message)).text;
    return (
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={styles.userBubble}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`You said: ${text}`}
        accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Message actions' }] : undefined}
        onAccessibilityAction={onLongPress ? onLongPress : undefined}
      >
        {images.length > 0 ? (
          <View style={styles.images}>
            {images.map((image, index) => (
              <Image key={`${image.uri}-${index}`} source={{ uri: image.uri }} style={styles.image} accessibilityLabel={`Photo ${index + 1}`} />
            ))}
          </View>
        ) : null}
        {text ? <Text style={styles.userText}>{text}</Text> : null}
      </Pressable>
    );
  }

  if (message.role !== 'assistant') return null;

  // The text holds a marker (<!--ano:tcN-->) where each tool call (card) belongs, so prose and
  // cards draw in the order the assistant wrote them. Calls no marker points to follow the text.
  const text = stripPersona(rawText(message));
  const toolCalls: ToolCall[] = message.toolCalls ?? [];

  // Nothing to draw yet: the run's activity row (the orb) shows that Ano is working.
  if (!text && toolCalls.length === 0) return null;

  const referenced = new Set<number>();
  for (const piece of splitMarkers(text)) if (piece.type === 'call') referenced.add(piece.index);
  const toolCallAt = (index: number) => toolCalls.find((tc) => tc.id.endsWith(`:tc${index}`));
  const unreferenced = toolCalls.filter((tc) => {
    const match = /:tc(\d+)$/.exec(tc.id);
    return !match || !referenced.has(Number(match[1]));
  });

  const renderToolCall = (index: number) => {
    const tc = toolCallAt(index);
    return tc ? <ToolCallSlot key={tc.id} toolCall={tc} toolMessage={toolResults?.get(tc.id)} /> : null;
  };

  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} style={styles.assistantContainer} accessible={false}>
      {text ? <AssistantMarkdown text={text} streaming={streaming} renderToolCall={renderToolCall} /> : null}
      {unreferenced.map((tc) => (
        <ToolCallSlot key={tc.id} toolCall={tc} toolMessage={toolResults?.get(tc.id)} />
      ))}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.bubble,
    borderBottomRightRadius: radii.bubbleTail,
    backgroundColor: colors.accent,
    gap: 8,
  },
  userText: {
    ...type.body,
    color: colors.white,
  },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  image: { width: 96, height: 96, borderRadius: 12, backgroundColor: colors.accentTint },
  assistantContainer: {
    alignSelf: 'flex-start',
    width: '100%',
    paddingRight: 24,
    gap: 12,
  },
});
