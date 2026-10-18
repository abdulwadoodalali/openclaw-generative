// BriefItem: one card of Ano's Home (contract in src/home/cards.ts). Row 1 is the agent's face and
// name (or the scope dot and source on cards without an agent) with how fresh it is, and the stake on
// the right in mono; then the claim, why now, and one accent pill (answer cards: a chip per option;
// today cards: the agenda). A decide, answer or headsUp card without a why or an action is not drawn.
// Tapping the card asks Ano about it, the pill sends its prompt, a chip sends that answer: the
// actions `open`, `act` and `answer`. Home draws the same card through BriefCard.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radii, shadows } from '@/theme';
import { AgentFace } from '../../components/chat/AgentFace';
import { tapSelection } from '../../components/chat/haptics';
import { agentLabel, cardProblem, readCard, type CardTone, type HomeCard } from '../../home/cards';
import { formatClock } from '../../home/verdict';
import { relativeTime } from '../../lib/relativeTime';
import type { CodeComponentProps, JsonValue } from '../types.ts';
import { GenUiFallback } from './GenUiFallback.tsx';

const TONE_DOT: Record<CardTone, string> = {
  accent: colors.accent,
  household: colors.household,
  default: colors.inkTertiary,
};

/** "Commercial Ops" reads "From Commercial Ops"; a source that already says "From ..." is kept. */
export function sourceLabel(source: string): string {
  return /^from\b/i.test(source) ? source : `From ${source}`;
}

export type BriefCardProps = {
  card: HomeCard;
  /** The agent's display name (Home has the gateway's list); null draws the source instead. */
  agentName: string | null;
  onOpen?: () => void;
  onAct?: () => void;
  onOption?: (option: string) => void;
  /** Quiet buttons after the pill (the deck's Snooze and Hand off). */
  secondary?: React.ReactNode;
  /** Deck cards float; list cards sit flat. */
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
  /** VoiceOver actions on the card (the deck's swipes). */
  accessibilityActions?: ReadonlyArray<{ name: string; label: string }>;
  onAccessibilityAction?: (name: string) => void;
};

export function BriefCard(props: BriefCardProps) {
  const { card, agentName, onOpen, onAct, onOption, secondary, raised = false, style, accessibilityActions, onAccessibilityAction } = props;
  const [pressed, setPressed] = useState(false);
  const fresh = card.at !== null ? relativeTime(card.at) : '';
  const meta = [agentName ?? (card.source ? sourceLabel(card.source) : null), fresh || (agentName ? card.source : null)].filter(Boolean).join(' · ');
  const showOptions = card.options.length > 0 && onOption;
  const showPill = !showOptions && card.action && onAct;
  const label = [meta, card.title, card.why, card.stake].filter(Boolean).join('. ');

  const body = (
    <>
      {meta || card.stake ? (
        <View style={styles.metaRow}>
          {card.agent ? (
            <AgentFace agentId={card.agent} initial={(agentName ?? agentLabel(card.agent)).charAt(0).toUpperCase()} size={20} />
          ) : meta ? (
            <View style={[styles.dot, { backgroundColor: TONE_DOT[card.tone] }]} />
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          {card.stake ? <Text style={styles.stake}>{card.stake}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.title}>{card.title}</Text>
      {card.why ? <Text style={styles.why}>{card.why}</Text> : null}
      {card.events.length > 0 ? (
        <View style={styles.events}>
          {card.events.map((event) => (
            <View key={`${event.minutes}:${event.title}`} style={styles.eventRow}>
              <Text style={styles.eventTime}>{formatClock(event.minutes)}</Text>
              <Text style={styles.eventTitle} numberOfLines={1}>
                {event.title}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  // The body and the buttons are siblings (a button inside a button is invalid on the web and
  // confuses VoiceOver); pressing the body still scales the whole card.
  return (
    <View style={[styles.card, raised && shadows.card, pressed && styles.pressed, style]}>
      {onOpen ? (
        <Pressable
          onPress={onOpen}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Opens a chat about this"
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={(e) => onAccessibilityAction?.(e.nativeEvent.actionName)}
          style={styles.body}
        >
          {body}
        </Pressable>
      ) : (
        <View
          style={styles.body}
          accessible
          accessibilityLabel={label}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={(e) => onAccessibilityAction?.(e.nativeEvent.actionName)}
        >
          {body}
        </View>
      )}
      {showOptions || showPill || secondary ? (
        <View style={styles.footer}>
          {showOptions
            ? card.options.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => onOption?.(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Answer ${option}`}
                  style={({ pressed: chipPressed }) => [styles.chip, chipPressed && styles.buttonPressed]}
                >
                  <Text style={styles.chipLabel} numberOfLines={1}>
                    {option}
                  </Text>
                </Pressable>
              ))
            : null}
          {showPill && card.action ? (
            <Pressable
              onPress={onAct}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={card.action.label}
              style={({ pressed: pillPressed }) => [styles.pill, pillPressed && styles.buttonPressed]}
            >
              <Text style={styles.pillLabel} numberOfLines={1}>
                {card.action.label}
              </Text>
            </Pressable>
          ) : null}
          {secondary}
        </View>
      ) : null}
    </View>
  );
}

export function BriefItem({ props, instanceId, onAction }: CodeComponentProps) {
  const card = readCard(props);
  if (!card) return <GenUiFallback name="BriefItem" props={props} error="a title is required" />;
  if (cardProblem(card)) return null;

  const base: Record<string, JsonValue> = { id: card.id, kind: card.kind, title: card.title };
  if (card.why) base.why = card.why;
  if (card.source) base.source = card.source;
  if (card.agent) base.agent = card.agent;
  const { action } = card;

  return (
    <BriefCard
      card={card}
      agentName={card.agent ? agentLabel(card.agent) : null}
      onOpen={() => {
        void tapSelection();
        onAction({ component: 'BriefItem', instanceId, name: 'open', payload: base });
      }}
      onAct={
        action
          ? () => {
              void tapSelection();
              onAction({ component: 'BriefItem', instanceId, name: 'act', payload: { ...base, label: action.label, prompt: action.prompt } });
            }
          : undefined
      }
      onOption={(option) => {
        void tapSelection();
        onAction({ component: 'BriefItem', instanceId, name: 'answer', payload: { ...base, option } });
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    padding: 16,
    gap: 12,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  body: { gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  meta: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
  stake: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 16, fontVariant: ['tabular-nums'], color: colors.ink },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.ink },
  why: { fontSize: 14, lineHeight: 20, color: colors.inkSecondary },
  events: { gap: 6, marginTop: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  eventTime: { width: 72, fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'], color: colors.inkSecondary },
  eventTitle: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.ink },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pill: {
    height: 36,
    maxWidth: '100%',
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.white },
  chip: {
    height: 36,
    maxWidth: '100%',
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.accentText },
  buttonPressed: { opacity: 0.7 },
});
