// Home: Ano's desk. The masthead (date, greeting, the orb and a verdict line built from counts),
// then the Home canvas as sections (src/components/home/HomeBrief.tsx): the "Needs you" triage deck,
// Heads-up, Today, Handled, Moving, the agent's other blocks, the pinned canvases, and after 18:00
// Tomorrow. An "Ask Ano" composer starts a new chat. Up top: the sidebar button (shows Chat with its
// sidebar open) and Customize, a half sheet where you tell Ano how to change Home (it updates behind
// the sheet, with an Undo toast). A tap on a card opens a new chat about it. Swiping a deck card
// does it, snoozes it until tonight, or hands it to its agent in the background through Home's own
// runner (src/components/home/useTriage.ts). The first open of the day plays The Morning Deal.
// Home is page 0 of the pager; Chat is a swipe away (src/lib/pager.ts).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EVENING_HOUR, HOME_CANVAS_ID, HOME_SETUP_PROMPT } from '../canvas/protocol';
import { canvasRunners } from '../canvas/runner';
import type { Canvas, CanvasBlock } from '../canvas/types';
import { useAutoRefresh } from '../canvas/useAutoRefresh';
import { useCanvasEditor } from '../canvas/useCanvasEditor';
import { AnoOrb } from '../components/AnoOrb';
import { CheckIcon } from '../components/CanvasIcons';
import { tapLight } from '../components/chat/haptics';
import { MenuIcon } from '../components/chat/icons';
import { useAgents } from '../components/chat/useAgents';
import { useBrain } from '../components/chat/useBrain';
import { useReduceMotion } from '../components/chat/useReduceMotion';
import { Composer, COMPOSER_FADE, useComposerKeyboardOffset, type ComposerHandle } from '../components/Composer';
import { ConnectionStrip } from '../components/home/ConnectionStrip';
import { CustomizeSheet } from '../components/home/CustomizeSheet';
import { EmptyHome } from '../components/home/EmptyHome';
import { HomeBrief, type InProgress } from '../components/home/HomeBrief';
import { HomeSkeleton } from '../components/home/HomeSkeleton';
import { MorningDealHeader } from '../components/home/MorningDealHeader';
import { PinnedStrip } from '../components/home/PinnedStrip';
import { SlidersIcon } from '../components/home/SlidersIcon';
import { useMorningDeal } from '../components/home/useMorningDeal';
import { handOffPrompt, triage, useTriage } from '../components/home/useTriage';
import { RunActivityRow } from '../components/RunActivityRow';
import { UndoToast } from '../components/UndoToast';
import type { UiAction } from '../genui/types.ts';
import { agentLabel, homeLayout, waitingIds, type HomeCard } from '../home/cards';
import { isHidden, markSent, unsentHandOffs, withoutEntries } from '../home/triage';
import { verdictLine } from '../home/verdict';
import { describeTap } from '../lib/canvasAsk';
import { requestSidebar, showChat } from '../lib/pager';
import { orbSignal } from '../orb/orbStore';
import { useAno } from '../state/AnoProvider';
import { colors, fonts, shadows, type } from '../theme';
import { useAskInChat } from './useAskInChat';
import { useCanvasMenu } from './useCanvasMenu';
import { useCanvas, useCanvases } from './useCanvases';
import { useSettingsSheet } from './useSettingsSheet';
import { useUndoToast } from './useUndoToast';
import { ENV_USER_NAME } from '../env';

const MAX_PINNED = 10;
const TICK_MS = 60_000;
/** Figures inside the verdict line (counts, times) are set in mono. */
const FIGURE_RE = /(\d+(?::\d{2})?(?:\s[ap]m)?)/;

function greeting(now: Date): string {
  const h = now.getHours();
  const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return ENV_USER_NAME ? `Good ${part}, ${ENV_USER_NAME}` : `Good ${part}`;
}

/** The current time, re-read every minute and on return to the app (snoozes run out, "Clear until" moves on). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return now;
}

/** The block a card came from, rebuilt for "a chat about this card" (describeTap). */
function cardBlock(card: HomeCard): CanvasBlock {
  const props: Record<string, unknown> = { id: card.id, kind: card.kind, title: card.title };
  if (card.why) props.why = card.why;
  if (card.stake) props.stake = card.stake;
  if (card.source) props.source = card.source;
  if (card.agent) props.agent = card.agent;
  return { component: 'BriefItem', props };
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const keyboardOffset = useComposerKeyboardOffset();
  const { connection, reconnect } = useAno();
  const { ask } = useAskInChat();
  const settings = useSettingsSheet({ autoOpen: true });
  const menu = useCanvasMenu({ toastBottom: 100 });
  const reduceMotion = useReduceMotion();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const { threads } = useAno();
  const { agents, agentFor } = useAgents();
  const agent = agentFor(threads.defaults.agentId);
  // The chip on Home is the default for new chats (an open chat keeps its own settings); long-press on send picks a brain for one message.
  const { brain, sheet: brainSheet } = useBrain({
    scope: 'defaults',
    onSendOnce: (text, _images, once) => {
      void tapLight();
      void ask(text, { once });
      composerRef.current?.clear();
    },
  });

  const all = useCanvases();
  const home = useCanvas(HOME_CANVAS_ID);
  const editor = useCanvasEditor(HOME_CANVAS_ID);
  // A daily refresh is not an edit you asked for: only edits and taps offer Undo.
  const undoToast = useUndoToast(HOME_CANVAS_ID, editor.kind === 'refresh' ? null : editor.lastChange);
  const triageState = useTriage();
  const now = useNow();

  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  const blocks = home?.blocks;
  const hasBlocks = (blocks?.length ?? 0) > 0;
  const ready = connection.status === 'ready';
  const deal = useMorningDeal({ reduceMotion });

  const layout = useMemo(
    () => homeLayout(blocks ?? [], { now, eveningHour: EVENING_HOUR, hidden: (id) => isHidden(triageState[id], now.getTime()) }),
    [blocks, now, triageState],
  );
  const waiting = useMemo(() => waitingIds(blocks ?? []), [blocks]);
  const inProgress = useMemo<InProgress[]>(() => {
    const out: Array<InProgress & { since: number }> = [];
    for (const [id, entry] of Object.entries(triageState)) {
      if (entry.state === 'handing' && waiting.has(id)) out.push({ id, title: entry.title, agent: entry.agent, since: entry.since });
    }
    return out.sort((a, b) => b.since - a.since);
  }, [triageState, waiting]);

  // Snoozes that ran out, and hand-offs whose card the agent has answered (turned into a receipt or removed).
  useEffect(() => {
    if (home) triage.prune(waiting);
  }, [home, waiting, now]);

  // Hand-offs go out as one background turn on Home's runner when it is free (they wait while Home is
  // busy or offline). A turn that fails puts its cards back in the deck.
  const unsent = useMemo(() => unsentHandOffs(triageState), [triageState]);
  const sendUiEvent = editor.sendUiEvent;
  useEffect(() => {
    const runner = canvasRunners.get(HOME_CANVAS_ID);
    if (!ready || unsent.length === 0 || runner.getState().running) return;
    const ids = unsent.map((u) => u.id);
    triage.update((state) => markSent(state, ids));
    void sendUiEvent(handOffPrompt(unsent)).then(() => {
      if (runner.getState().error) triage.update((state) => withoutEntries(state, ids));
    });
  }, [ready, unsent, editor.running, sendUiEvent]);

  // When he clears the last card himself: "Nothing needs you" gets a moss check and the orb its done ring.
  const acted = useRef(false);
  const [cleared, setCleared] = useState(false);
  const needs = layout.needs.length;
  const previousNeeds = useRef(needs);
  useEffect(() => {
    const before = previousNeeds.current;
    previousNeeds.current = needs;
    if (needs > 0) {
      setCleared(false);
      return;
    }
    if (before > 0 && acted.current) {
      setCleared(true);
      orbSignal({ type: 'done', ms: 0 });
    }
    acted.current = false;
  }, [needs]);

  const pinned = useMemo(
    () =>
      all
        .filter((c) => c.kind === 'user' && c.pinned)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_PINNED),
    [all],
  );

  // The Home canvas (once it has something on it) and the pinned canvases refresh when their policy says they are due.
  const pinnedKey = pinned.filter((c) => c.blocks.length > 0).map((c) => c.id).join(',');
  const autoRefreshIds = useMemo(
    () => [...(pinnedKey ? pinnedKey.split(',') : []), ...(hasBlocks ? [HOME_CANVAS_ID] : [])],
    [pinnedKey, hasBlocks],
  );
  useAutoRefresh(autoRefreshIds);

  const askAno = useCallback(
    (text: string) => {
      void tapLight();
      void ask(text);
    },
    [ask],
  );

  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.name ?? agentLabel(id), [agents]);

  const onDo = useCallback(
    (card: HomeCard) => {
      acted.current = true;
      triage.done(card.id);
      if (card.action) void ask(card.action.prompt);
    },
    [ask],
  );
  const onSnooze = useCallback((card: HomeCard) => {
    acted.current = true;
    triage.snooze(card.id);
  }, []);
  const onHandOff = useCallback((card: HomeCard) => {
    acted.current = true;
    triage.handOff(card);
  }, []);
  const onAnswer = useCallback((card: HomeCard, option: string) => {
    acted.current = true;
    triage.handOff(card, option);
  }, []);
  const onOpenCard = useCallback(
    (card: HomeCard) => {
      void tapLight();
      const block = cardBlock(card);
      void ask(describeTap('Home', block, { component: 'BriefItem', name: 'open', payload: block.props }));
    },
    [ask],
  );
  const onActCard = useCallback(
    (card: HomeCard) => {
      if (!card.action) return;
      void tapLight();
      void ask(card.action.prompt);
    },
    [ask],
  );
  // A tap inside one of the agent's other blocks opens a new chat about it.
  const onTapBlock = useCallback(
    (block: CanvasBlock, action: UiAction) => {
      void tapLight();
      void ask(describeTap('Home', block, { component: action.component, name: action.name, payload: action.payload }));
    },
    [ask],
  );

  const openCanvas = useCallback((c: Canvas) => router.push({ pathname: '/canvas/[id]', params: { id: c.id } }), []);
  const openSidebar = useCallback(() => {
    showChat();
    requestSidebar();
  }, []);
  const openMenu = useCallback((c: Canvas) => menu.openMenu(c.id), [menu]);
  const seeAll = useCallback(() => router.push('/canvases'), []);
  const setUp = useCallback(() => void editor.send(HOME_SETUP_PROMPT), [editor]);
  const sendToEditor = useCallback((text: string) => void editor.send(text), [editor]);
  const scrollGesture = useMemo(() => Gesture.Native(), []);

  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 56 : insets.top + 9;
  const toastVisible = undoToast.toast !== null && home?.version === undoToast.toast.version;
  const toast = toastVisible ? { message: 'Home updated', onUndo: undoToast.undo } : null;
  const settingUp = !hasBlocks && editor.running;
  const verdict = verdictLine({
    needs,
    handled: layout.handled.length,
    headsUp: layout.headsUp.length,
    inProgress: inProgress.length,
    upcoming: layout.today ? layout.today.upcoming : null,
  });
  const pinnedStrip = pinned.length > 0 ? <PinnedStrip canvases={pinned} onOpen={openCanvas} onMenu={openMenu} onSeeAll={seeAll} /> : null;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
        <GestureDetector gesture={scrollGesture}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingTop }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <View style={styles.top}>
                <Pressable
                  onPress={openSidebar}
                  accessibilityRole="button"
                  accessibilityLabel="Chats and menu"
                  style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
                >
                  <MenuIcon size={22} color={colors.ink} />
                </Pressable>
                <Pressable
                  onPress={() => setCustomizeOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Customize Home"
                  style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
                >
                  <SlidersIcon size={20} color={colors.ink} />
                </Pressable>
              </View>
              <View style={styles.greeting}>
                <Text style={styles.date}>{dateLine}</Text>
                <Text style={styles.hello} accessibilityRole="header">
                  {greeting(now)}
                </Text>
              </View>
              <View style={styles.verdictRow}>
                <AnoOrb size={32} />
                {/* An empty Home still says something beside the orb, so it never floats alone. */}
                <Verdict text={hasBlocks ? verdict : "I'm here. Your desk is empty."} cleared={hasBlocks && cleared && needs === 0} />
              </View>
            </View>

            {deal.phase === 'ring' ? <MorningDealHeader weekday={weekday} agentId={agent.id} initial={agent.initial} onRingDrawn={deal.ringDrawn} /> : null}

            {editor.running && deal.phase !== 'ring' ? (
              <View style={styles.working}>
                <View style={styles.flex}>
                  <RunActivityRow activity={editor.activity} />
                </View>
                <Pressable
                  onPress={editor.stop}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Stop"
                  style={styles.stop}
                >
                  <Text style={styles.stopLabel}>Stop</Text>
                </Pressable>
              </View>
            ) : null}

            {home && hasBlocks ? (
              <HomeBrief
                canvasId={home.id}
                layout={layout}
                inProgress={inProgress}
                phase={deal.phase}
                reduceMotion={reduceMotion}
                agentName={agentName}
                scrollGesture={scrollGesture}
                onDo={onDo}
                onSnooze={onSnooze}
                onHandOff={onHandOff}
                onAnswer={onAnswer}
                onOpen={onOpenCard}
                onAct={onActCard}
                onTapBlock={onTapBlock}
                pinned={pinnedStrip}
              />
            ) : null}

            {home && !hasBlocks && !settingUp ? <EmptyHome ready={ready} onSetup={setUp} onChip={sendToEditor} /> : null}

            {settingUp ? <HomeSkeleton /> : null}

            {!customizeOpen && editor.error ? (
              <Pressable
                onPress={editor.clearError}
                accessibilityRole="button"
                accessibilityLabel={`Error: ${editor.error}. Tap to dismiss`}
                style={styles.errorNote}
              >
                <Text style={styles.errorText}>{editor.error}</Text>
              </Pressable>
            ) : null}

            {home && hasBlocks ? null : pinnedStrip}
          </ScrollView>
        </GestureDetector>

        {!customizeOpen && toast ? (
          <View style={styles.toastWrap} pointerEvents="box-none">
            <UndoToast message={toast.message} onUndo={toast.onUndo} />
          </View>
        ) : null}
        <ConnectionStrip status={connection.status} onRetry={reconnect} onOpenSettings={settings.open} />
        <Composer
          ref={composerRef}
          onSend={askAno}
          busy={false}
          sendDisabled={!ready}
          placeholder={ready ? 'Ask Ano' : 'Waiting for the connection'}
          accessibilityLabel="Ask Ano"
          brain={brain}
        />
      </KeyboardAvoidingView>
      <CustomizeSheet visible={customizeOpen} onClose={() => setCustomizeOpen(false)} editor={editor} ready={ready} toast={toast} />
      {brainSheet}
      {settings.sheet}
      {menu.element}
    </View>
  );
}

/** The verdict sentence with its figures in mono; a moss check fades in when he has just cleared the deck. */
function Verdict({ text, cleared }: { text: string; cleared: boolean }) {
  const check = useRef(new Animated.Value(cleared ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(check, { toValue: cleared ? 1 : 0, duration: 240, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [cleared, check]);
  return (
    <View style={styles.verdict} accessible accessibilityRole="summary" accessibilityLabel={text}>
      {cleared ? (
        <Animated.View style={{ opacity: check }}>
          <CheckIcon size={16} color={colors.household} />
        </Animated.View>
      ) : null}
      <Text style={styles.verdictText}>
        {text.split(FIGURE_RE).map((part, i) =>
          i % 2 === 1 ? (
            <Text key={i} style={styles.figure}>
              {part}
            </Text>
          ) : (
            part
          ),
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: COMPOSER_FADE + 24, gap: 28 },
  header: { gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { gap: 4 },
  date: { ...type.label, color: colors.inkSecondary },
  hello: {
    fontFamily: fonts.rounded,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.ink,
  },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  verdict: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  verdictText: { flexShrink: 1, fontSize: 16, lineHeight: 22, fontWeight: '500', color: colors.ink },
  figure: { fontFamily: fonts.mono, fontVariant: ['tabular-nums'] },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  },
  pressed: { opacity: 0.7 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stop: { minHeight: 44, justifyContent: 'center' },
  stopLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.accentText },
  errorNote: { padding: 12, borderRadius: 18, backgroundColor: colors.accentTint },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.accentText },
  toastWrap: { paddingHorizontal: 16, paddingBottom: 16 },
});
