// The Chat screen: who you talk to in the header (face, name, live status), the conversation, and the
// composer card with how Ano thinks (the brain chip). The sidebar holds every chat across agents.
// Every message goes through the AG-UI layer (useChat). It is page 1 of the Home pager.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { Message, ToolMessage } from '@copilotkit/react-native/headless';
import { agentStatus } from '../chat/agents';
import { Composer, useComposerKeyboardOffset, type ComposerHandle } from '../components/Composer';
import { Header } from '../components/Header';
import { AgentSheet } from '../components/chat/AgentSheet';
import { useBrain } from '../components/chat/useBrain';
import { EmptyChat, useSuggestions } from '../components/chat/EmptyChat';
import { ErrorStrip } from '../components/chat/ErrorStrip';
import { AssistantRow, UserRow } from '../components/chat/MessageRows';
import { QueuedPills } from '../components/chat/QueuedPills';
import { ScrollPill } from '../components/chat/ScrollPill';
import { Sidebar } from '../components/chat/Sidebar';
import { useAgents } from '../components/chat/useAgents';
import { RunActivityRow } from '../components/RunActivityRow';
import { Button, Text } from '../components/ui';
import { parseUiEvent } from '../genui/catalog.ts';
import { setPagerLocked, showHome, subscribeSidebarRequest, takeSidebarRequest } from '../lib/pager';
import { promptBeforeMessage } from '../lib/chatOrigin';
import { colors } from '../theme';
import { useSettingsSheet } from './useSettingsSheet';
import { pairingCommands } from '../connectPolicy';
import { useAno, useChat, type PairingState, type PickedImage } from '../state/AnoProvider';
import type { ConnectionInfo } from '../openclaw/gatewayConnection';

function statusLine(info: ConnectionInfo, pairing: PairingState): { text: string; color: string } {
  if (pairing.phase === 'running') return { text: 'Connecting to Ano...', color: colors.inkTertiary };
  switch (info.status) {
    case 'ready':
      return { text: 'Private \u00B7 only you', color: colors.accent };
    case 'connecting':
      return { text: 'Connecting', color: colors.inkTertiary };
    case 'reconnecting':
      return { text: 'Reconnecting', color: colors.inkTertiary };
    case 'needs-pairing':
      return { text: 'Waiting for approval', color: colors.accent };
    case 'auth-failed':
      return { text: 'Not authorised', color: colors.danger };
    case 'error':
      return { text: 'Cannot reach Ano', color: colors.danger };
    default:
      return { text: 'Offline', color: colors.inkTertiary };
  }
}

/** The strip text for a connection that is down, or null while it is fine or still starting up. */
function stripFor(info: ConnectionInfo, pairing: PairingState, hasDraft: boolean): string | null {
  if (pairing.phase === 'running') return null;
  const draft = hasDraft ? ' \u00B7 Draft saved' : '';
  switch (info.status) {
    case 'reconnecting':
    case 'error':
      return `Gateway offline${draft}`;
    case 'auth-failed':
      return `Not authorised${draft}`;
    case 'needs-pairing':
      return `Waiting for approval${draft}`;
    default:
      return null;
  }
}

/** "Today 8:14 AM", "Yesterday 8:14 AM", or "Oct 3, 8:14 AM". */
function dividerLabel(ms: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

type Row = { key: string; message: Message } | { key: string; activity: true } | { key: string; chip: string };

/** How the list follows a growing answer: 'end' sticks to the bottom, 'anchor' keeps the question near the top, 'free' leaves it. */
type FollowMode = 'end' | 'anchor' | 'free';

/** Stop following once the answer is taller than this share of the viewport. */
const ANCHOR_RELEASE = 0.65;
/** Space between the header and the question at the top. */
const ANCHOR_OFFSET = 16;
/** Within this distance of the end the list counts as "at the bottom". */
const BOTTOM_SLACK = 60;

export function ChatScreen() {
  const ano = useAno();
  const keyboardOffset = useComposerKeyboardOffset();
  const chat = useChat();
  const settingsSheet = useSettingsSheet();
  const { agents, agentFor } = useAgents();
  const listRef = useRef<FlatList<Row>>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    setPagerLocked(sidebarOpen);
    return () => setPagerLocked(false);
  }, [sidebarOpen]);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const { connection, threads, threadsStore } = ano;
  const ready = connection.status === 'ready';
  const status = statusLine(connection, ano.pairing);
  const agent = agentFor(chat.prefs.agentId);
  const suggestions = useSuggestions(agent.id);
  const activeThread = threads.activeKey ? threads.threads.find((t) => t.key === threads.activeKey) : undefined;
  const divider = activeThread ? dividerLabel(activeThread.updatedAt) : null;

  const { rows, toolResults } = useMemo(() => {
    const results = new Map<string, ToolMessage>();
    const visible: Message[] = [];
    for (const m of chat.messages) {
      if (m.role === 'tool') results.set(m.toolCallId, m);
      else if (m.role === 'user' || m.role === 'assistant') visible.push(m);
    }
    // A [ui-event] turn is plumbing, not conversation: it shows as a small chip, never as a bubble.
    const list: Row[] = visible.map((message) => {
      const text = message.role === 'user' && typeof message.content === 'string' ? message.content : '';
      const event = parseUiEvent(text);
      return event ? { key: message.id, chip: `${event.component}: ${event.event}` } : { key: message.id, message };
    });
    // The activity row stays for the whole run: a reply can pause for a minute while tools or
    // another agent work, and the orb shows that it is still going.
    if (chat.isRunning) list.push({ key: 'activity', activity: true });
    return { rows: list, toolResults: results };
  }, [chat.messages, chat.isRunning]);

  const lastAssistantId = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) if (chat.messages[i].role === 'assistant') return chat.messages[i].id;
    return null;
  }, [chat.messages]);

  const lastUserKey = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if ('message' in row && row.message.role === 'user') return row.key;
    }
    return null;
  }, [rows]);

  // ---- scrolling -------------------------------------------------------------------------------
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const mode = useRef<FollowMode>('end');
  const baseHeight = useRef<number | null>(null);
  const viewportHeight = useRef(0);
  /** The last user message when a send started (null = none yet); undefined = nothing pending. */
  const sentAfter = useRef<string | null | undefined>(undefined);

  const anchorQuestion = useCallback(() => {
    if (lastUserKey === null) return;
    const index = rowsRef.current.findIndex((r) => r.key === lastUserKey);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0, viewOffset: ANCHOR_OFFSET, animated: true });
  }, [lastUserKey]);

  // The sent question appears: put it near the top and let the answer grow below it.
  useEffect(() => {
    if (sentAfter.current === undefined || lastUserKey === null || lastUserKey === sentAfter.current) return;
    sentAfter.current = undefined;
    mode.current = 'anchor';
    baseHeight.current = null;
    requestAnimationFrame(anchorQuestion);
  }, [lastUserKey, anchorQuestion]);

  // Another chat: start at its end.
  useEffect(() => {
    mode.current = 'end';
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
  }, [threads.activeKey]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setAtBottom(distance < BOTTOM_SLACK);
    if (distance < BOTTOM_SLACK && mode.current === 'free') mode.current = 'end';
  }, []);

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (mode.current === 'end') {
        listRef.current?.scrollToEnd({ animated: false });
      } else if (mode.current === 'anchor') {
        if (baseHeight.current === null) baseHeight.current = height;
        if (height - baseHeight.current > viewportHeight.current * ANCHOR_RELEASE) mode.current = 'free';
        else anchorQuestion();
      }
    },
    [anchorQuestion],
  );

  const jumpToBottom = () => {
    mode.current = 'end';
    listRef.current?.scrollToEnd({ animated: true });
  };

  // ---- actions ---------------------------------------------------------------------------------
  const handleSend = useCallback(
    (text: string, images: PickedImage[]) => {
      sentAfter.current = lastUserKey;
      void chat.send(text, { images });
    },
    [chat, lastUserKey],
  );

  const { brain, sheet: brainSheet } = useBrain({
    scope: 'chat',
    onSendOnce: (text, images, once) => {
      sentAfter.current = lastUserKey;
      void chat.send(text, { images, once });
      composerRef.current?.clear();
    },
  });

  const strip = stripFor(connection, ano.pairing, hasDraft);
  const queueRestore = (id: string) => {
    const item = chat.dequeue(id);
    if (item) composerRef.current?.setDraft(item.text, item.images);
  };

  // Home's sidebar button asks for the sidebar; take a request made before this screen mounted too.
  useEffect(() => {
    const open = () => {
      if (!takeSidebarRequest()) return;
      setSidebarOpen(true);
      void threadsStore.refresh();
    };
    open();
    return subscribeSidebarRequest(open);
  }, [threadsStore]);

  return (
    <View style={styles.root}>
      <Header
        agentId={agent.id}
        agentName={agent.name}
        agentInitial={agent.initial}
        status={agentStatus(chat.isRunning ? chat.activity : null, connection)}
        running={chat.isRunning}
        offline={!ready}
        onOpenSidebar={() => {
          setSidebarOpen(true);
          void threadsStore.refresh();
        }}
        onOpenAgents={() => setAgentsOpen(true)}
        onNewChat={() => {
          chat.newThread(null);
          composerRef.current?.focus();
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
        <View style={styles.flex} onLayout={(e) => (viewportHeight.current = e.nativeEvent.layout.height)}>
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={Separator}
            ListHeaderComponent={
              divider && rows.length > 0 ? (
                <View style={styles.dividerWrap}>
                  <Text variant="caption" className="text-ink-secondary" style={styles.tabular}>
                    {divider}
                  </Text>
                </View>
              ) : undefined
            }
            onScroll={onScroll}
            scrollEventThrottle={32}
            onScrollBeginDrag={() => (mode.current = 'free')}
            onContentSizeChange={onContentSizeChange}
            onScrollToIndexFailed={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListEmptyComponent={
              chat.loadingHistory ? undefined : ready ? (
                <View style={styles.empty}>
                  <EmptyChat agent={agent} suggestions={suggestions} onPick={(prompt) => handleSend(prompt, [])} />
                </View>
              ) : (
                <ConnectionNote info={connection} pairing={ano.pairing} onOpenSettings={settingsSheet.open} />
              )
            }
            renderItem={({ item }) => {
              if ('activity' in item) return <RunActivityRow activity={chat.activity} chat />;
              if ('chip' in item) {
                return (
                  <View className="self-end rounded-chip bg-secondary px-2 py-[3px]" accessibilityRole="text">
                    <Text variant="caption">{item.chip}</Text>
                  </View>
                );
              }
              const { message } = item;
              if (message.role === 'user') {
                return (
                  <UserRow
                    message={message}
                    images={chat.imagesFor(message.id)}
                    onEdit={(text, images) => composerRef.current?.setDraft(text, images)}
                  />
                );
              }
              return (
                <AssistantRow
                  message={message}
                  streaming={chat.isRunning && message.id === lastAssistantId}
                  isLatest={message.id === lastAssistantId}
                  toolResults={toolResults}
                  process={chat.processFor(message.id)}
                  threadTitle={activeThread?.title ?? 'Canvas'}
                  prompt={promptBeforeMessage(chat.messages, message.id)}
                  sessionKey={threads.activeKey}
                  onRetry={() => void chat.retry()}
                />
              );
            }}
          />
          <ScrollPill visible={!atBottom && rows.length > 0} streaming={chat.isRunning} onPress={jumpToBottom} />
        </View>

        <QueuedPills
          queue={chat.queue}
          paused={chat.queuePaused}
          onSendNow={(id) => void chat.sendNow(id)}
          onResume={() => void chat.resumeQueue()}
          onRestore={queueRestore}
        />
        {strip ? (
          <ErrorStrip message={strip} actionLabel="Retry" onAction={ano.reconnect} secondaryLabel="Settings" onSecondary={settingsSheet.open} />
        ) : chat.error ? (
          <ErrorStrip message={chat.error} actionLabel="Retry" onAction={() => void chat.retry()} secondaryLabel="Dismiss" onSecondary={chat.clearError} />
        ) : null}
        <Composer
          ref={composerRef}
          onSend={handleSend}
          onStop={chat.stop}
          busy={chat.isRunning}
          sendDisabled={!ready}
          allowImages
          onHasDraft={setHasDraft}
          placeholder={ready ? `Message ${agent.name}` : 'Waiting for the connection'}
          brain={brain}
        />
      </KeyboardAvoidingView>

      <Sidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        threads={threads.threads}
        activeKey={threads.activeKey}
        agentFor={agentFor}
        onSelect={(key) => {
          if (key !== threads.activeKey) void chat.openThread(key);
        }}
        onOpenCanvases={() => router.push('/canvases')}
        onRename={(thread, title) => void threadsStore.rename(thread.key, title)}
        onPin={(thread) => void threadsStore.pin(thread.key, !thread.pinned)}
        onDelete={async (thread) => {
          const wasActive = thread.key === threads.activeKey;
          await threadsStore.archive(thread);
          if (wasActive) chat.newThread(null);
        }}
        onOpenSettings={settingsSheet.open}
        connectionText={status.text}
        connectionColor={status.color}
        defaultAgentId={threads.defaults.agentId}
        onGoHome={showHome}
      />

      <AgentSheet
        visible={agentsOpen}
        onClose={() => setAgentsOpen(false)}
        agents={agents.length > 0 ? agents : [agent]}
        currentId={agent.id}
        onPick={(id) => {
          setAgentsOpen(false);
          if (id !== agent.id) chat.setAgent(id);
        }}
      />
      {brainSheet}
      {settingsSheet.sheet}
    </View>
  );
}

function Separator() {
  return <View style={{ height: 14 }} />;
}

/** The empty list while the gateway is not connected: what is going on and how to fix it. */
function ConnectionNote({ info, pairing, onOpenSettings }: { info: ConnectionInfo; pairing: PairingState; onOpenSettings: () => void }) {
  if (pairing.phase === 'running') {
    // First run: a brief connecting state, no sheet, no buttons.
    return (
      <View style={styles.empty}>
        <Text variant="title">Connecting to Ano...</Text>
      </View>
    );
  }
  const waiting = info.status === 'connecting' || info.status === 'reconnecting' || info.status === 'idle';
  return (
    <View style={styles.empty}>
      <Text variant="title">{waiting ? 'Connecting to Ano' : 'Ano is not connected'}</Text>
      {info.detail || pairing.message ? (
        <Text variant="secondary" className="text-center">
          {info.detail ?? pairing.message}
        </Text>
      ) : null}
      {info.status === 'needs-pairing' ? (
        <Text variant="mono" selectable className="text-center">
          {pairingCommands(info.pairingRequestId).join('\n')}
        </Text>
      ) : null}
      <Button variant="outline" size="sm" onPress={onOpenSettings}>
        Set up connection
      </Button>
      {__DEV__ ? <DemoLink /> : null}
    </View>
  );
}

/** Development only: the recorded demo thread, which needs no gateway. */
function DemoLink() {
  return (
    <Text variant="caption" className="text-amber-text underline" accessibilityRole="link" onPress={() => router.push('/demo')}>
      Open demo thread
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 72 },
  dividerWrap: { alignItems: 'center', paddingBottom: 14 },
  tabular: { fontVariant: ['tabular-nums'] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 48 },
});
