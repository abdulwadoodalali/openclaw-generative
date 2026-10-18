// Shown under the conversation for as long as a run is going: the orb, what Ano is doing, and how
// long it has been at it. A handoff to another agent can take a minute; this row keeps that visible.
// The chat's row (`chat`) follows the global orb store; canvas runs colour the orb from their activity.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RunActivity, RunMode } from '../openclaw/OpenClawAgent';
import { visualForMode } from '../orb/orbMachine.ts';
import { AnoOrb } from './AnoOrb';
import { Text } from './ui';

const MODE_TEXT: Record<RunMode, string> = {
  waiting: 'Getting started',
  thinking: 'Thinking',
  working: 'Working on it',
  answering: 'Writing',
};

/** Seconds shown only once a run is slow enough for the number to help. */
const SHOW_ELAPSED_AFTER_S = 8;

export function RunActivityRow({ activity, chat = false }: { activity: RunActivity | null; chat?: boolean }) {
  const mode = activity?.mode ?? 'waiting';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // While text streams the note is stale; the orb and "Writing" say enough.
  const headline = mode === 'answering' ? MODE_TEXT.answering : activity?.note ?? MODE_TEXT[mode];
  const detail = [
    mode === 'answering' ? null : activity?.step,
    activity?.model ? `via ${activity.model}` : null,
    elapsed >= SHOW_ELAPSED_AFTER_S ? `${elapsed}s` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.row} accessible accessibilityRole="progressbar" accessibilityLabel={`Ano: ${headline}`}>
      <View style={styles.orb}>
        <AnoOrb state={chat ? undefined : visualForMode(mode)} />
      </View>
      <View style={styles.text}>
        <Text variant="secondary" className="text-ink" numberOfLines={2}>
          {headline}
        </Text>
        {detail ? (
          <Text variant="caption" className="text-ink-secondary" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  orb: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
