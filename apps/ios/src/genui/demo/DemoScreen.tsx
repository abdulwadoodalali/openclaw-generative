// Dev-only demo thread (HANDOFF step 8): a recorded conversation that shows every generative UI
// component with no gateway and no model. A real OpenClawAgent (real fence transformer, real
// renderers) runs against createDemoGateway, so the pixels are exactly what a live reply draws.
// Taps inside components go to this agent too (UiActionProvider) and get the scripted
// acknowledgement. Reach it from the empty thread's "Open demo thread" link or at /demo.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgent, useCopilotKit, UseAgentUpdate } from '@copilotkit/react-native/headless';
import type { Message, ToolMessage } from '@copilotkit/react-native/headless';
import { MessageBubble } from '../../components/MessageBubble';
import { RunActivityRow } from '../../components/RunActivityRow';
import { Button, Text } from '../../components/ui';
import { OpenClawAgent, type RunActivity } from '../../openclaw/OpenClawAgent';
import { catalogSeenReady, getAnoAgentHooks } from '../../state/agentHooks';
import { colors, type } from '../../theme';
import { UiActionProvider, createChatUiActionHandler } from '../actions.tsx';
import { genuiDefinitions } from '../registryInstance.ts';
import { UI_EVENT_PREFIX } from '../types.ts';
import { createDemoGateway, type DemoGateway } from './demoGateway.ts';
import { DEMO_SCRIPT } from './demoScript.ts';

export const DEMO_AGENT_ID = 'ano-demo';
const REPLAY_PAUSE_MS = 500;

type DemoSession = { agent: OpenClawAgent; gateway: DemoGateway };
type Row = { key: string; message: Message } | { key: string; activity: true };

export function DemoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { copilotkit } = useCopilotKit();

  // One agent per screen visit, on its own session key (never the real app's thread). Registered
  // right here because useAgent below needs it to exist during the first render (like AgentHost).
  const [{ agent, gateway }] = useState<DemoSession>(() => {
    const demoGateway = createDemoGateway(DEMO_SCRIPT);
    const demoAgent = new OpenClawAgent(demoGateway, getAnoAgentHooks());
    demoAgent.agentId = DEMO_AGENT_ID; // OpenClawAgent defaults to "ano"; CopilotKit requires id == key
    demoAgent.selectThread(`demo:${randomUUID()}`);
    copilotkit.addAgent__unsafe_dev_only({ id: DEMO_AGENT_ID, agent: demoAgent });
    return { agent: demoAgent, gateway: demoGateway };
  });

  const [replaying, setReplaying] = useState(false);
  const cancelReplay = useRef(false);
  const listRef = useRef<FlatList<Row>>(null);
  const stickToBottom = useRef(true);

  // Re-register after a StrictMode cleanup, drop the agent when the screen goes away.
  useEffect(() => {
    copilotkit.addAgent__unsafe_dev_only({ id: DEMO_AGENT_ID, agent });
    // GenUiRegistrar only watches the main chat agent: feed this agent's define_component calls to the registry.
    const subscription = agent.subscribe({
      onMessagesChanged: ({ messages }) => {
        genuiDefinitions.ingestMessages(messages);
        if (messages[messages.length - 1]?.role === 'user') stickToBottom.current = true; // follow a new turn
      },
    });
    return () => {
      subscription.unsubscribe();
      agent.abortRun();
      copilotkit.removeAgent__unsafe_dev_only(DEMO_AGENT_ID);
    };
  }, [agent, copilotkit]);

  // Subscribes this screen to message and run-state changes (throttled while streaming).
  useAgent({
    agentId: DEMO_AGENT_ID,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged, UseAgentUpdate.OnStateChanged],
    throttleMs: 50,
  });

  useEffect(
    () => () => {
      cancelReplay.current = true;
    },
    [],
  );

  const sendUserMessage = useCallback(
    async (text: string) => {
      await catalogSeenReady; // the persisted "catalog seen" map decides brief vs delta on the first send
      if (agent.isRunning) return;
      agent.addMessage({ id: randomUUID(), role: 'user', content: text });
      // copilotkit.runAgent (not agent.runAgent) so frontend tools run the CopilotKit way.
      await copilotkit.runAgent({ agent });
    },
    [agent, copilotkit],
  );

  // Taps in the thread reach this agent, and get the scripted reply from the demo gateway.
  const uiActionHandler = useMemo(
    () => createChatUiActionHandler({ send: sendUserMessage, sendUiEvent: sendUserMessage }),
    [sendUserMessage],
  );

  const playNext = useCallback(() => {
    const turn = DEMO_SCRIPT.turns[gateway.nextTurn];
    if (turn) void sendUserMessage(turn.user);
  }, [gateway, sendUserMessage]);

  const replayAll = useCallback(async () => {
    cancelReplay.current = false;
    setReplaying(true);
    await agent.detachActiveRun();
    gateway.reset();
    agent.selectThread(`demo:${randomUUID()}`);
    try {
      for (const turn of DEMO_SCRIPT.turns) {
        if (cancelReplay.current) return;
        await sendUserMessage(turn.user);
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, REPLAY_PAUSE_MS);
        await promise;
      }
    } finally {
      setReplaying(false);
    }
  }, [agent, gateway, sendUserMessage]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const running = agent.isRunning;
  const agentState: { activity?: RunActivity } | undefined = agent.state;
  const { rows, toolResults } = useMemo(() => {
    const results = new Map<string, ToolMessage>();
    const visible: Message[] = [];
    for (const m of agent.messages) {
      if (m.role === 'tool') results.set((m as ToolMessage).toolCallId, m as ToolMessage);
      else if (m.role === 'assistant') visible.push(m);
      else if (m.role === 'user' && !(typeof m.content === 'string' && m.content.trimStart().startsWith(UI_EVENT_PREFIX))) visible.push(m);
    }
    const list: Row[] = visible.map((message) => ({ key: message.id, message }));
    if (running) list.push({ key: 'activity', activity: true });
    return { rows: list, toolResults: results };
  }, [agent.messages, running]);

  const lastAssistantId = useMemo(() => {
    for (let i = agent.messages.length - 1; i >= 0; i--) if (agent.messages[i].role === 'assistant') return agent.messages[i].id;
    return null;
  }, [agent.messages]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stickToBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (stickToBottom.current) listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 60 : insets.top + 13;
  const nextTurn = DEMO_SCRIPT.turns[gateway.nextTurn];
  const busy = running || replaying;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop }]}>
        <View style={styles.headerRow}>
          <Button variant="outline" size="sm" onPress={goBack} accessibilityLabel="Back">
            Back
          </Button>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              Demo thread
            </Text>
            <Text variant="secondary" numberOfLines={1}>
              Demo thread - recorded, Sample data
            </Text>
          </View>
        </View>
        <View style={styles.headerRow}>
          <Button size="sm" onPress={playNext} disabled={busy || !nextTurn} accessibilityLabel="Play next turn">
            Play next turn
          </Button>
          <Button variant="outline" size="sm" onPress={() => void replayAll()} disabled={replaying} accessibilityLabel="Replay all">
            Replay all
          </Button>
        </View>
      </View>
      <UiActionProvider handler={uiActionHandler}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={Separator}
          onScroll={onScroll}
          scrollEventThrottle={32}
          onContentSizeChange={onContentSizeChange}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text variant="title">A recorded thread</Text>
              <Text variant="secondary" className="text-center">
                {nextTurn ? `Tap Play next turn to ask: "${nextTurn.user}"` : 'Tap Replay all to run the demo again.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if ('activity' in item) return <RunActivityRow activity={agentState?.activity ?? null} />;
            return <MessageBubble message={item.message} streaming={running && item.message.id === lastAssistantId} toolResults={toolResults} />;
          }}
        />
      </UiActionProvider>
    </View>
  );
}

function Separator() {
  return <View style={{ height: 14 }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { gap: 10, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, gap: 2 },
  title: { ...type.title, color: colors.ink },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 48 },
});
