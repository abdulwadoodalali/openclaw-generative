// "How Ano thinks": three tiles (Quick, Balanced, Deep) and, behind one row, the raw model list and
// the effort control. In "message" mode (long-press on send) only the tiles show and a tap sends
// with that choice without changing the chat's setting.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { modelLabel, type ModelOption } from '../../canvas/models';
import { effortCopy, VISIBLE_EFFORTS, type Effort } from '../../chat/effort';
import { modelOutcome, type QuickPick } from '../../chat/models';
import type { ChatPrefs } from '../../chat/prefs';
import { colors, radii, type } from '../../theme';
import { ChevronRightIcon, CheckIcon } from '../CanvasIcons';
import { Segmented } from '../Segmented';
import { Sheet } from '../Sheet';
import { effortLabel, matchingPick, shortModel } from './brain';
import { tapSelection } from './haptics';

export type BrainSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 'chat' changes the open chat and the default; 'message' only picks for one send. */
  mode: 'chat' | 'message';
  prefs: Pick<ChatPrefs, 'model' | 'effort'>;
  agentDefaultModel: string | null;
  models: ModelOption[];
  picks: QuickPick[];
  onPick: (pick: QuickPick) => void;
  onModel: (model: string | null) => void;
  onEffort: (effort: Effort | null) => void;
};

const EFFORT_OPTIONS = VISIBLE_EFFORTS.map((value) => ({ value, label: effortLabel(value) }));

export function BrainSheet({ visible, onClose, mode, prefs, agentDefaultModel, models, picks, onPick, onModel, onEffort }: BrainSheetProps) {
  const matched = matchingPick(picks, prefs);
  const isDefault = prefs.model === null && prefs.effort === null;
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || (!matched && !isDefault);
  const available = models.filter((m) => m.available);
  const resolvedDefault = agentDefaultModel ? shortModel(modelLabel(agentDefaultModel)) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      label={mode === 'message' ? 'Choose how Ano thinks for this message' : 'How Ano thinks'}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>{mode === 'message' ? 'For this message only' : 'How Ano thinks'}</Text>
        </View>
      }
    >
      <View style={styles.tiles}>
        {picks.map((pick) => {
          const selected = mode === 'chat' && matched?.id === pick.id;
          const model = pick.model ? shortModel(modelLabel(pick.model)) : resolvedDefault;
          return (
            <Pressable
              key={pick.id}
              onPress={() => {
                void tapSelection();
                onPick(pick);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${pick.label}. ${pick.hint}${model ? `. ${model}` : ''}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}
            >
              <Text style={styles.tileTitle}>{pick.label}</Text>
              <Text style={styles.tileHint} numberOfLines={1}>
                {pick.hint}
              </Text>
              {model ? (
                <Text style={styles.tileModel} numberOfLines={1}>
                  {model}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {mode === 'chat' ? (
        <>
          <Pressable
            onPress={() => setCustomOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Custom model and effort"
            accessibilityState={{ expanded: showCustom }}
            style={({ pressed }) => [styles.customRow, pressed && styles.pressed]}
          >
            <Text style={styles.customLabel}>Custom model and effort</Text>
            <View style={{ transform: [{ rotate: showCustom ? '90deg' : '0deg' }] }}>
              <ChevronRightIcon size={16} color={colors.inkTertiary} />
            </View>
          </Pressable>

          {showCustom ? (
            <View style={styles.custom}>
              <Text style={styles.sectionLabel}>Model</Text>
              <ModelRow
                name="Default (agent's choice)"
                detail={resolvedDefault}
                selected={prefs.model === null}
                onPress={() => onModel(null)}
              />
              {available.map((model) => (
                <ModelRow
                  key={model.ref}
                  name={shortModel(model.label)}
                  outcome={modelOutcome(model.ref)}
                  detail={model.provider}
                  selected={prefs.model === model.ref}
                  onPress={() => onModel(model.ref)}
                />
              ))}

              <Text style={[styles.sectionLabel, styles.effortLabel]}>Effort</Text>
              <Segmented
                label="Effort"
                options={EFFORT_OPTIONS}
                value={(prefs.effort ?? '') as Effort}
                onChange={(value) => {
                  void tapSelection();
                  onEffort(value);
                }}
              />
              <Text style={styles.effortCopy}>{effortCopy(prefs.effort)}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

function ModelRow({
  name,
  outcome,
  detail,
  selected,
  onPress,
}: {
  name: string;
  outcome?: string | null;
  detail?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        void tapSelection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${name}${outcome ? `. ${outcome}` : ''}`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.modelRow, pressed && styles.pressed]}
    >
      <View style={styles.modelText}>
        <Text style={styles.modelName} numberOfLines={1}>
          {name}
          {outcome ? <Text style={styles.modelOutcome}>{`  ${outcome}`}</Text> : null}
        </Text>
        {detail ? (
          <Text style={styles.modelDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? <CheckIcon size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.ink },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    height: 76,
    borderRadius: radii.tile,
    backgroundColor: colors.fill,
    borderWidth: 2,
    borderColor: colors.fill,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 1,
  },
  tileSelected: { borderColor: colors.accent },
  tileTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  tileHint: { ...type.caption, color: colors.inkSecondary },
  tileModel: { fontSize: 11, lineHeight: 14, color: colors.inkSecondary },
  customRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  customLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  custom: { gap: 4 },
  sectionLabel: { ...type.label, color: colors.inkSecondary, marginBottom: 4 },
  effortLabel: { marginTop: 12 },
  effortCopy: { ...type.secondary, color: colors.inkSecondary, marginTop: 6 },
  modelRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  modelText: { flex: 1 },
  modelName: { fontSize: 15, lineHeight: 20, color: colors.ink },
  modelOutcome: { ...type.secondary, color: colors.accentText },
  modelDetail: { ...type.caption, color: colors.inkSecondary },
  pressed: { opacity: 0.7 },
});
