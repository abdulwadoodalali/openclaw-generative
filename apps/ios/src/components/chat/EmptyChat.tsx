// The empty chat: the agent's face, "What's on your mind?", the agent's hint and at most two
// suggestion pills built from live data (the first action of Home's brief, the most recently
// updated pinned canvas). With nothing live there is one static pill per agent. No grid of cards.
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HOME_CANVAS_ID } from '../../canvas/protocol.ts';
import { isPlainObject } from '../../canvas/types';
import type { AgentOption } from '../../chat/agents';
import { useCanvases } from '../../screens/useCanvases';
import { colors, fonts, type } from '../../theme';
import { AgentFace } from './AgentFace';
import { tapSelection } from './haptics';

export type Suggestion = { label: string; prompt: string };

/** One pill for common agent ids when nothing live is around; anything else gets the fallback. */
const STATIC_SUGGESTION: Record<string, Suggestion> = {
  main: { label: 'Plan my day', prompt: 'Help me plan my day.' },
  finance: { label: "How's my budget?", prompt: "How's my budget this month?" },
  notes: { label: 'Summarise my recent notes', prompt: 'Summarise my most recent notes.' },
};
const FALLBACK_SUGGESTION: Suggestion = { label: 'What can you do?', prompt: 'What can you help me with?' };

/** At most two suggestions for this agent, from live canvases first. */
export function useSuggestions(agentId: string): Suggestion[] {
  const canvases = useCanvases();
  return useMemo(() => {
    const live: Suggestion[] = [];
    const home = canvases.find((c) => c.id === HOME_CANVAS_ID);
    for (const block of home?.blocks ?? []) {
      if (block.component !== 'BriefItem') continue;
      const action = block.props.action;
      const title = typeof block.props.title === 'string' ? block.props.title.trim() : '';
      if (isPlainObject(action) && typeof action.label === 'string' && typeof action.prompt === 'string' && action.label.trim()) {
        // The button label alone ("Check") means nothing away from its card: name the subject.
        live.push({ label: title ? `${action.label.trim()}: ${title}` : action.label.trim(), prompt: action.prompt });
        break;
      }
    }
    const pinned = canvases.filter((c) => c.kind === 'user' && c.pinned).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (pinned) live.push({ label: `Ask about ${pinned.title}`, prompt: `What should I know about "${pinned.title}"? Use its latest data.` });
    return live.length > 0 ? live.slice(0, 2) : [STATIC_SUGGESTION[agentId] ?? FALLBACK_SUGGESTION];
  }, [canvases, agentId]);
}

export type EmptyChatProps = {
  agent: AgentOption;
  suggestions: Suggestion[];
  onPick: (prompt: string) => void;
};

export function EmptyChat({ agent, suggestions, onPick }: EmptyChatProps) {
  return (
    <View style={styles.wrap}>
      <AgentFace agentId={agent.id} initial={agent.initial} size={64} />
      <Text style={styles.title}>What's on your mind?</Text>
      {agent.hint ? <Text style={styles.hint}>{agent.hint}</Text> : null}
      <View style={styles.pills}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.label}
              onPress={() => {
                void tapSelection();
                onPick(suggestion.prompt);
              }}
              accessibilityRole="button"
              accessibilityLabel={suggestion.label}
              style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
            >
              <Text style={styles.pillLabel} numberOfLines={1}>
                {suggestion.label}
              </Text>
            </Pressable>
          ))}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingHorizontal: 24 },
  title: { fontFamily: fonts.rounded, fontSize: 24, lineHeight: 30, fontWeight: '700', color: colors.ink, textAlign: 'center', marginTop: 6 },
  hint: { ...type.secondary, color: colors.inkSecondary, textAlign: 'center' },
  pills: { alignItems: 'center', gap: 8, marginTop: 12 },
  pill: { height: 36, maxWidth: 300, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.fill },
  pillLabel: { fontSize: 14, lineHeight: 18, color: colors.ink },
  pressed: { transform: [{ scale: 0.97 }] },
});
