// "Who runs this canvas": one sheet, a few plain choices. A name makes it the canvas's own agent,
// the instructions say what it is for, the model and the OpenClaw agent decide who does the work,
// and the refresh policy says when it runs by itself. Saved with canvasStore.setAgent (no new
// canvas version). The phone cannot create OpenClaw agents, so this lives in the app.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { canvasStore } from '../canvas/instance';
import { loadModels, modelLabel, type ModelOption } from '../canvas/models';
import { MAX_INSTRUCTIONS_LENGTH, type Canvas, type RefreshPolicy } from '../canvas/types';
import { useAgents } from './chat/useAgents';
import { useAno } from '../state/AnoProvider';
import { colors, radii, type } from '../theme';
import { CheckIcon } from './CanvasIcons';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';

const SUGGESTIONS = [
  'Keep the numbers current from my accounts and vault',
  'Track this list and tick off what is done',
  'Tell me what changed since last time',
];

const REFRESH_OPTIONS: ReadonlyArray<{ value: RefreshPolicy; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'open', label: 'On open' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Mornings' },
];

type Draft = { name: string; instructions: string; model: string | null; agentId: string; refresh: RefreshPolicy };

type ModelsState = { status: 'loading' } | { status: 'ready'; models: ModelOption[] } | { status: 'failed' };

export type CanvasAgentSheetProps = {
  /** The canvas the sheet is for; null closes it. */
  canvas: Canvas | null;
  onClose: () => void;
};

export function CanvasAgentSheet({ canvas, onClose }: CanvasAgentSheetProps) {
  const { gateway, settings } = useAno();
  const defaultAgent = settings.agentId;
  const { agents, agentFor } = useAgents();

  // Keep the last canvas while the sheet slides away so the content does not flash empty.
  const [shown, setShown] = useState<Canvas | null>(canvas);
  useEffect(() => {
    if (canvas) setShown(canvas);
  }, [canvas]);
  const c = canvas ?? shown;
  const open = canvas !== null;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<ModelsState>({ status: 'loading' });

  // Each time the sheet opens, start from what is saved.
  useEffect(() => {
    if (!canvas) return;
    const a = canvas.agent;
    setDraft({
      name: a.name ?? '',
      instructions: a.instructions,
      model: a.model,
      agentId: a.agentId ?? defaultAgent,
      refresh: a.refresh,
    });
    // Only on open: later store changes must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvas?.id]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setModels({ status: 'loading' });
    loadModels((method, params) => gateway.request(method, params)).then(
      (list) => alive && setModels({ status: 'ready', models: list.filter((m) => m.available) }),
      () => alive && setModels({ status: 'failed' }),
    );
    return () => {
      alive = false;
    };
  }, [open, gateway]);

  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = () => {
    if (!c || !draft) return;
    canvasStore.setAgent(c.id, {
      name: draft.name.trim() || null,
      instructions: draft.instructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH),
      model: draft.model,
      modelName: draft.model ? (listed.find((m) => m.ref === draft.model)?.label ?? c.agent.modelName) : null,
      agentId: draft.agentId === defaultAgent ? null : draft.agentId,
      refresh: draft.refresh,
    });
    onClose();
  };

  // Models to list: the available ones, plus the saved one if the list no longer has it.
  const listed = models.status === 'ready' ? models.models : [];
  const rows: Array<{ ref: string | null; label: string; hint: string | null }> = [
    { ref: null, label: 'Default', hint: 'Whatever the agent normally uses' },
    ...listed.map((m) => ({ ref: m.ref, label: m.label, hint: m.provider })),
  ];
  if (draft?.model && !listed.some((m) => m.ref === draft.model)) {
    rows.push({ ref: draft.model, label: c?.agent.modelName ?? modelLabel(draft.model), hint: 'Saved choice' });
  }

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      label="Canvas agent"
      header={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Canvas agent
          </Text>
          <Text style={styles.explainer}>Choose who runs this canvas and what it should do. It works whenever you ask for a change or refresh.</Text>
        </View>
      }
      footer={
        <View style={styles.buttons}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" style={({ pressed }) => [styles.button, styles.buttonOutline, pressed && styles.pressed]}>
            <Text style={styles.buttonOutlineLabel}>Cancel</Text>
          </Pressable>
          <Pressable onPress={save} accessibilityRole="button" accessibilityLabel="Save agent" style={({ pressed }) => [styles.button, styles.buttonDark, pressed && styles.pressed]}>
            <Text style={styles.buttonDarkLabel}>Save</Text>
          </Pressable>
        </View>
      }
    >
      {draft ? (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={draft.name}
              onChangeText={(name) => update({ name })}
              placeholder="Ano"
              placeholderTextColor={colors.inkSecondary}
              maxLength={40}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel="Agent name"
              style={styles.input}
            />
            <Text style={styles.hint}>Optional. Give it a name and this canvas gets its own agent.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>What should it do?</Text>
            <TextInput
              value={draft.instructions}
              onChangeText={(instructions) => update({ instructions })}
              placeholder="Say what this canvas is for"
              placeholderTextColor={colors.inkSecondary}
              maxLength={MAX_INSTRUCTIONS_LENGTH}
              multiline
              textAlignVertical="top"
              accessibilityLabel="What should it do"
              style={[styles.input, styles.multiline]}
            />
            <View style={styles.chips}>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => update({ instructions: s })}
                  accessibilityRole="button"
                  accessibilityLabel={`Use: ${s}`}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                >
                  <Text style={styles.chipLabel}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Model</Text>
            <View style={styles.group}>
              {rows.map((r, i) => {
                const selected = r.ref === draft.model;
                return (
                  <Pressable
                    key={r.ref ?? 'default'}
                    onPress={() => update({ model: r.ref })}
                    accessibilityRole="radio"
                    accessibilityLabel={r.label}
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    style={({ pressed }) => [styles.modelRow, i > 0 && styles.modelRowDivider, pressed && styles.pressed]}
                  >
                    <View style={styles.modelText}>
                      <Text style={styles.modelLabel} numberOfLines={1}>
                        {r.label}
                      </Text>
                      {r.hint ? (
                        <Text style={styles.modelHint} numberOfLines={1}>
                          {r.hint}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? <CheckIcon size={18} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {models.status === 'loading' ? <Text style={styles.hint}>Loading models</Text> : null}
            {models.status === 'failed' ? <Text style={styles.hint}>Could not load the model list. Default still works.</Text> : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Runs on</Text>
            <Segmented
              options={(agents.some((x) => x.id === draft.agentId) ? agents : [agentFor(draft.agentId), ...agents]).map((x) => ({ value: x.id, label: x.name }))}
              value={draft.agentId}
              onChange={(agentId) => update({ agentId })}
              label="Runs on"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Refresh</Text>
            <Segmented options={REFRESH_OPTIONS} value={draft.refresh} onChange={(refresh) => update({ refresh })} label="Refresh" />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, gap: 4 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink },
  explainer: { fontSize: 14, lineHeight: 19, color: colors.inkSecondary },
  field: { gap: 8 },
  label: { ...type.label, color: colors.inkSecondary },
  hint: { fontSize: 13, lineHeight: 18, color: colors.inkSecondary },
  input: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.group,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.white,
    fontSize: 16,
    lineHeight: 21,
    color: colors.ink,
  },
  multiline: { minHeight: 96 },
  chips: { gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.group, backgroundColor: colors.accentTint, justifyContent: 'center' },
  chipLabel: { fontSize: 14, lineHeight: 19, color: colors.accentText },
  group: { backgroundColor: colors.white, borderRadius: radii.group, overflow: 'hidden' },
  modelRow: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modelRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  modelText: { flex: 1, gap: 1 },
  modelLabel: { fontSize: 16, lineHeight: 21, color: colors.ink },
  modelHint: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  buttonOutline: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.white },
  buttonOutlineLabel: { fontSize: 16, lineHeight: 21, color: colors.ink },
  buttonDark: { backgroundColor: colors.ink },
  buttonDarkLabel: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.white },
  pressed: { opacity: 0.7 },
});
