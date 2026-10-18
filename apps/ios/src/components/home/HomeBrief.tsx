// The Home canvas drawn as sections (layout from src/home/cards.ts), each shown only when it has
// something: Needs you (the triage deck), Heads-up (3, then "+N more"), Today (the next 3 events),
// Handled (one row that opens to the receipts and the hand-offs still in progress), Moving (one
// card), every other catalog block the agent added, the pinned canvases, and after 18:00 Tomorrow.
// While Home is dealt (The Morning Deal) the sections are hidden, then spring in one after another.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import type { CanvasBlock } from '../../canvas/types';
import { BriefCard } from '../../genui/components/BriefItem';
import { UiActionProvider } from '../../genui/actions';
import { GenUiToolCall } from '../../genui/GenUiToolCall';
import type { UiAction } from '../../genui/types.ts';
import type { HomeCard, HomeLayout } from '../../home/cards';
import { formatClock } from '../../home/verdict';
import { relativeTime } from '../../lib/relativeTime';
import { colors, fonts, radii, type } from '../../theme';
import { ChevronRightIcon } from '../CanvasIcons';
import { AgentFace } from '../chat/AgentFace';
import { tapSelection } from '../chat/haptics';
import { TriageDeck } from './TriageDeck';
import { DEAL_STAGGER_MS, type DealPhase } from './useMorningDeal';

const NATIVE = Platform.OS !== 'web';
const HEADS_UP_VISIBLE = 3;
const TODAY_VISIBLE = 3;

/** A hand-off sent to an agent that has not reported back yet. */
export type InProgress = { id: string; title: string; agent: string | null };

export type HomeBriefProps = {
  canvasId: string;
  layout: HomeLayout;
  inProgress: readonly InProgress[];
  phase: DealPhase;
  reduceMotion: boolean;
  agentName: (id: string) => string;
  scrollGesture: GestureType;
  /** Swipes and buttons of the deck. */
  onDo: (card: HomeCard) => void;
  onSnooze: (card: HomeCard) => void;
  onHandOff: (card: HomeCard) => void;
  onAnswer: (card: HomeCard, option: string) => void;
  /** A tap on a card's body: a chat about it. */
  onOpen: (card: HomeCard) => void;
  /** A list card's pill: its prompt in a new chat. */
  onAct: (card: HomeCard) => void;
  onTapBlock: (block: CanvasBlock, action: UiAction) => void;
  /** The pinned canvases strip, drawn between the agent's other blocks and Tomorrow. */
  pinned: React.ReactNode;
};

export function HomeBrief(props: HomeBriefProps) {
  const { canvasId, layout, inProgress, phase, reduceMotion, agentName, onOpen, onAct, onTapBlock, pinned } = props;
  const sections: Array<{ key: string; node: React.ReactNode }> = [];

  if (layout.needs.length > 0) {
    sections.push({
      key: 'needs',
      node: (
        <Section label="Needs you" signal>
          <TriageDeck
            cards={layout.needs}
            agentName={agentName}
            reduceMotion={reduceMotion}
            scrollGesture={props.scrollGesture}
            onDo={props.onDo}
            onSnooze={props.onSnooze}
            onHandOff={props.onHandOff}
            onAnswer={props.onAnswer}
            onOpen={onOpen}
          />
        </Section>
      ),
    });
  }
  if (layout.headsUp.length > 0) {
    sections.push({
      key: 'headsUp',
      node: (
        <Section label="Heads-up">
          <HeadsUpList cards={layout.headsUp} agentName={agentName} onOpen={onOpen} onAct={onAct} />
        </Section>
      ),
    });
  }
  if (layout.today && layout.today.upcoming.length > 0) {
    sections.push({ key: 'today', node: <TodayStrip card={layout.today.card} upcoming={layout.today.upcoming} onOpen={onOpen} /> });
  }
  if (layout.handled.length > 0 || inProgress.length > 0) {
    sections.push({ key: 'handled', node: <HandledRow handled={layout.handled} inProgress={inProgress} agentName={agentName} /> });
  }
  if (layout.moving) {
    const card = layout.moving;
    sections.push({
      key: 'moving',
      node: (
        <Section label="Moving">
          <BriefCard card={card} agentName={card.agent ? agentName(card.agent) : null} onOpen={() => onOpen(card)} onAct={() => onAct(card)} />
        </Section>
      ),
    });
  }
  for (const { block, index } of layout.other) {
    sections.push({ key: `block:${index}`, node: <BlockView canvasId={canvasId} index={index} block={block} onTap={onTapBlock} /> });
  }
  if (pinned) sections.push({ key: 'pinned', node: pinned });
  if (layout.tomorrow) {
    const card = layout.tomorrow;
    sections.push({
      key: 'tomorrow',
      node: (
        <Section label="Tomorrow">
          <BriefCard card={card} agentName={card.agent ? agentName(card.agent) : null} onOpen={() => onOpen(card)} onAct={() => onAct(card)} />
        </Section>
      ),
    });
  }

  return (
    <View style={styles.list}>
      {sections.map((section, index) => (
        <DealItem key={section.key} index={index} phase={phase} reduceMotion={reduceMotion}>
          {section.node}
        </DealItem>
      ))}
    </View>
  );
}

function Section({ label, signal = false, children }: { label: string; signal?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        {signal ? <View style={styles.signal} /> : null}
        <Text style={styles.label} accessibilityRole="header">
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

function HeadsUpList({
  cards,
  agentName,
  onOpen,
  onAct,
}: {
  cards: readonly HomeCard[];
  agentName: (id: string) => string;
  onOpen: (card: HomeCard) => void;
  onAct: (card: HomeCard) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, HEADS_UP_VISIBLE);
  const more = cards.length - shown.length;
  return (
    <>
      {shown.map((card) => (
        <BriefCard key={card.id} card={card} agentName={card.agent ? agentName(card.agent) : null} onOpen={() => onOpen(card)} onAct={() => onAct(card)} />
      ))}
      {more > 0 ? (
        <Pressable
          onPress={() => {
            void tapSelection();
            setAll(true);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Show ${more} more`}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        >
          <Text style={styles.moreLabel}>{`+${more} more`}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function TodayStrip({ card, upcoming, onOpen }: { card: HomeCard; upcoming: HomeCard['events']; onOpen: (card: HomeCard) => void }) {
  const events = upcoming.slice(0, TODAY_VISIBLE);
  return (
    <Section label="Today">
      <Pressable
        onPress={() => onOpen(card)}
        accessibilityRole="button"
        accessibilityLabel={events.map((e) => `${formatClock(e.minutes)}, ${e.title}`).join('. ')}
        accessibilityHint="Opens a chat about your day"
        style={({ pressed }) => [styles.panel, pressed && styles.pressed]}
      >
        {events.map((event) => (
          <View key={`${event.minutes}:${event.title}`} style={styles.eventRow}>
            <Text style={styles.eventTime}>{formatClock(event.minutes)}</Text>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {event.title}
            </Text>
          </View>
        ))}
      </Pressable>
    </Section>
  );
}

function HandledRow({ handled, inProgress, agentName }: { handled: readonly HomeCard[]; inProgress: readonly InProgress[]; agentName: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const head = handled.length > 0 ? `Handled ${handled.length}` : `In progress ${inProgress.length}`;
  const summary = [...handled.map((c) => c.title), ...inProgress.map((p) => p.title)].slice(0, 2).join(', ');
  return (
    <View style={styles.panel}>
      <Pressable
        onPress={() => {
          void tapSelection();
          setOpen((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${head}. ${summary}`}
        style={({ pressed }) => [styles.handledHead, pressed && styles.pressed]}
      >
        <Text style={styles.handledCount}>{head}</Text>
        <Text style={styles.handledSummary} numberOfLines={1}>
          {summary}
        </Text>
        <View style={open ? styles.chevronOpen : null}>
          <ChevronRightIcon size={16} color={colors.inkTertiary} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.receipts}>
          {inProgress.map((item) => (
            <Receipt key={`p:${item.id}`} agent={item.agent} agentName={agentName} title={item.title} note="In progress" />
          ))}
          {handled.map((card) => (
            <Receipt
              key={card.id}
              agent={card.agent}
              agentName={agentName}
              title={card.title}
              note={card.at !== null ? relativeTime(card.at) : null}
              stake={card.stake}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Receipt({
  agent,
  agentName,
  title,
  note,
  stake = null,
}: {
  agent: string | null;
  agentName: (id: string) => string;
  title: string;
  note: string | null;
  stake?: string | null;
}) {
  const name = agent ? agentName(agent) : null;
  const meta = [name, note].filter(Boolean).join(' · ');
  return (
    <View style={styles.receipt} accessible accessibilityLabel={[title, meta, stake].filter(Boolean).join('. ')}>
      {agent ? <AgentFace agentId={agent} initial={(name ?? agent).charAt(0).toUpperCase()} size={20} /> : <View style={styles.receiptDot} />}
      <View style={styles.receiptText}>
        <Text style={styles.receiptTitle}>{title}</Text>
        {meta ? <Text style={styles.receiptMeta}>{meta}</Text> : null}
      </View>
      {stake ? <Text style={styles.receiptStake}>{stake}</Text> : null}
    </View>
  );
}

function BlockView({ canvasId, index, block, onTap }: { canvasId: string; index: number; block: CanvasBlock; onTap: HomeBriefProps['onTapBlock'] }) {
  const handler = useMemo(() => (action: UiAction) => onTap(block, action), [block, onTap]);
  return (
    <UiActionProvider handler={handler}>
      <GenUiToolCall name={block.component} args={block.props} toolCallId={`${canvasId}:${index}`} pending={false} />
    </UiActionProvider>
  );
}

type DealItemProps = {
  index: number;
  phase: DealPhase;
  reduceMotion: boolean;
  children: React.ReactNode;
};

/** Hidden through pending and ring, springs in during deal (staggered), plain once done. */
function DealItem({ index, phase, reduceMotion, children }: DealItemProps) {
  const hidden = phase === 'pending' || phase === 'ring';
  const progress = useRef(new Animated.Value(hidden ? 0 : 1)).current;

  useEffect(() => {
    if (phase === 'pending' || phase === 'ring') {
      progress.setValue(0);
      return;
    }
    if (phase === 'done') {
      progress.setValue(1);
      return;
    }
    const animation = reduceMotion
      ? Animated.timing(progress, { toValue: 1, duration: 200, useNativeDriver: NATIVE })
      : Animated.sequence([
          Animated.delay(index * DEAL_STAGGER_MS),
          Animated.spring(progress, { toValue: 1, mass: 0.8, damping: 18, stiffness: 220, useNativeDriver: NATIVE }),
        ]);
    animation.start();
    return () => animation.stop();
  }, [phase, index, reduceMotion, progress]);

  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : -18, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.96, 1] });
  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale }] }} pointerEvents={hidden ? 'none' : 'auto'}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 28 },
  section: { gap: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...type.label, color: colors.inkSecondary },
  signal: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.signal },
  pressed: { opacity: 0.7 },
  moreButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  moreLabel: { ...type.label, color: colors.accentText, fontVariant: ['tabular-nums'] },
  panel: {
    padding: 16,
    gap: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  eventRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  eventTime: { width: 72, fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'], color: colors.inkSecondary },
  eventTitle: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.ink },
  handledHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  handledCount: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, fontWeight: '500', fontVariant: ['tabular-nums'], color: colors.householdText },
  handledSummary: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.inkSecondary },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  receipts: { gap: 12, paddingTop: 4 },
  receipt: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  receiptDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.fill },
  receiptText: { flex: 1, gap: 2 },
  receiptTitle: { fontSize: 14, lineHeight: 20, color: colors.ink },
  receiptMeta: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
  receiptStake: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, fontVariant: ['tabular-nums'], color: colors.ink },
});
