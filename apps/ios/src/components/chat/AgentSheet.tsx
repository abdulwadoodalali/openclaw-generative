// "Who do you want to talk to?": the agents from `agents.list`, face, name, one-line hint, a check on
// the current one. Choosing another starts a new chat with it.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AgentOption } from '../../chat/agents';
import { colors, radii, type } from '../../theme';
import { Sheet } from '../Sheet';
import { CheckIcon } from '../CanvasIcons';
import { AgentFace } from './AgentFace';
import { tapSelection } from './haptics';

export type AgentSheetProps = {
  visible: boolean;
  onClose: () => void;
  agents: AgentOption[];
  currentId: string;
  onPick: (agentId: string) => void;
};

export function AgentSheet({ visible, onClose, agents, currentId, onPick }: AgentSheetProps) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      label="Choose an agent"
      header={<Text style={styles.title}>Talk to</Text>}
      footer={<Text style={styles.note}>Each chat stays with the agent you start it with.</Text>}
      contentStyle={styles.content}
    >
      {agents.map((agent) => {
        const selected = agent.id === currentId;
        return (
          <Pressable
            key={agent.id}
            onPress={() => {
              void tapSelection();
              onPick(agent.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${agent.name}${agent.hint ? `. ${agent.hint}` : ''}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
          >
            <AgentFace agentId={agent.id} initial={agent.initial} size={36} />
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {agent.name}
              </Text>
              {agent.hint ? (
                <Text style={styles.hint} numberOfLines={1}>
                  {agent.hint}
                </Text>
              ) : null}
            </View>
            {selected ? <CheckIcon size={18} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.ink, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  content: { gap: 4 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: radii.group },
  rowSelected: { backgroundColor: colors.accentTint },
  rowText: { flex: 1 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.ink },
  hint: { ...type.secondary, color: colors.inkSecondary },
  note: { ...type.caption, color: colors.inkSecondary, textAlign: 'center', paddingBottom: 4 },
  pressed: { opacity: 0.7 },
});
