// One saved canvas, following design/Canvas.dc.html: the back button and version pill, the scope chip
// and title, the blocks drawn in order, and a composer that edits the canvas by asking. Every edit
// is a new version, so the undo toast can always take it back and the version sheet can restore any
// kept version. A canvas is locked or unlocked: locked, a tap on something opens a new chat about
// it and the composer is replaced by a quiet bar; unlocked, taps and the composer change the canvas.
// Refresh is in the header, by pulling down, and (for canvases with a policy) automatic.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canvasStore } from '../canvas/instance';
import { modelLabel } from '../canvas/models';
import type { Canvas, CanvasBlock } from '../canvas/types';
import { useAutoRefresh } from '../canvas/useAutoRefresh';
import { useCanvasEditor } from '../canvas/useCanvasEditor';
import { CanvasAgentSheet } from '../components/CanvasAgentSheet';
import { CanvasBlocks } from '../components/CanvasBlocks';
import { ChevronLeftIcon, ChevronRightIcon, LockIcon, PinIcon, UnlockIcon } from '../components/CanvasIcons';
import { RenameCanvasSheet, VersionsSheet } from '../components/CanvasSheets';
import { Composer, useComposerKeyboardOffset } from '../components/Composer';
import { RefreshButton } from '../components/RefreshButton';
import { RunActivityRow } from '../components/RunActivityRow';
import { UndoToast } from '../components/UndoToast';
import { VersionPill } from '../components/VersionPill';
import type { UiAction } from '../genui/types.ts';
import { describeTap } from '../lib/canvasAsk';
import { relativeTime } from '../lib/relativeTime';
import { useAno } from '../state/AnoProvider';
import { colors, fonts, radii } from '../theme';
import { useAskInChat } from './useAskInChat';
import { useCanvas } from './useCanvases';
import { useUndoToast } from './useUndoToast';

function goBackToCanvases() {
  if (router.canGoBack()) router.back();
  else router.replace('/canvases');
}

function BackButton() {
  return (
    <Pressable
      onPress={goBackToCanvases}
      accessibilityRole="button"
      accessibilityLabel="Back to Canvases"
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <ChevronLeftIcon size={20} color={colors.accent} />
      <Text style={styles.backLabel}>Canvases</Text>
    </Pressable>
  );
}

export function CanvasScreen({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const canvas = useCanvas(id);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void canvasStore.ready.then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  if (canvas) return <CanvasView canvas={canvas} />;
  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 56 : insets.top + 9;
  return (
    <View style={[styles.root, { paddingTop, paddingHorizontal: 16, gap: 16 }]}>
      <BackButton />
      {loaded ? (
        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header">
            Canvas not found
          </Text>
          <Text style={styles.note}>It may have been deleted. Your canvases are in the list.</Text>
        </View>
      ) : null}
    </View>
  );
}

function LockToggle({ locked, onPress }: { locked: boolean; onPress: () => void }) {
  const Glyph = locked ? LockIcon : UnlockIcon;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityLabel={locked ? 'Locked' : 'Editing'}
      accessibilityHint={locked ? 'Unlocks the canvas so taps and the composer change it' : 'Locks the canvas so a tap asks Ano about it'}
      accessibilityState={{ selected: locked }}
      style={({ pressed }) => [styles.pill, locked && styles.pillOn, pressed && styles.pressed]}
    >
      <Glyph size={15} color={locked ? colors.white : colors.ink} />
      <Text style={[styles.pillLabel, locked && styles.pillLabelOn]}>{locked ? 'Locked' : 'Editing'}</Text>
    </Pressable>
  );
}

function agentChipLabel(canvas: Canvas): string {
  const { name, model, modelName } = canvas.agent;
  return `${name ?? 'Ano'} \u00B7 ${model ? (modelName ?? modelLabel(model)) : 'Default model'}`;
}

function LockedBar({ onUnlock }: { onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const paddingBottom = Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 12);
  return (
    <View style={[styles.lockedBar, { paddingBottom }]}>
      <LockIcon size={18} color={colors.inkSecondary} />
      <Text style={styles.lockedText}>Locked. Tap anything to ask about it</Text>
      <Pressable
        onPress={onUnlock}
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        accessibilityHint="Lets taps and the composer change this canvas"
        style={({ pressed }) => [styles.unlock, pressed && styles.pressed]}
      >
        <Text style={styles.unlockLabel}>Unlock</Text>
      </Pressable>
    </View>
  );
}

function CanvasView({ canvas }: { canvas: Canvas }) {
  const insets = useSafeAreaInsets();
  const keyboardOffset = useComposerKeyboardOffset();
  const { connection } = useAno();
  const editor = useCanvasEditor(canvas.id);
  const undoToast = useUndoToast(canvas.id, editor.lastChange);
  const { ask } = useAskInChat();
  const [renameOpen, setRenameOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  const autoRefreshIds = useMemo(() => [canvas.id], [canvas.id]);
  useAutoRefresh(autoRefreshIds);

  const household = canvas.scope === 'household';
  const ready = connection.status === 'ready';
  const refreshing = editor.running && editor.kind === 'refresh';
  const paddingTop = Platform.OS === 'web' && insets.top === 0 ? 56 : insets.top + 9;
  const toastVisible = undoToast.toast !== null && canvas.version === undoToast.toast.version;

  const refreshNote = refreshing
    ? 'Refreshing'
    : canvas.lastRefreshedAt
      ? `Refreshed ${relativeTime(canvas.lastRefreshedAt)}`
      : 'Never refreshed';

  const refresh = useCallback(() => void editor.refresh(), [editor]);

  // Locked: a tap never edits. It starts a new chat about the thing that was tapped.
  const askAbout = useCallback(
    (block: CanvasBlock, action: UiAction) => {
      void ask(describeTap(canvas.title, block, { component: action.component, name: action.name, payload: action.payload }));
    },
    [ask, canvas.title],
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingTop }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        >
          <View style={styles.topRow}>
            <BackButton />
            <View style={styles.topActions}>
              <VersionPill version={canvas.version} by={canvas.updatedBy} at={canvas.updatedAt} onPress={() => setVersionsOpen(true)} />
              <RefreshButton refreshing={refreshing} onPress={refresh} mode={editor.activity?.mode} disabled={!ready} label="Refresh this canvas" />
            </View>
          </View>

          <View style={styles.titleBlock}>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => canvasStore.setScope(canvas.id, household ? 'private' : 'household')}
                hitSlop={{ top: 8, bottom: 8 }}
                accessibilityRole="button"
                accessibilityLabel={household ? 'Scope: household, shared' : 'Scope: just me'}
                accessibilityHint={household ? 'Makes this canvas private' : 'Shares this canvas with the household'}
                style={({ pressed }) => [styles.chip, household ? styles.chipHousehold : styles.chipPrivate, pressed && styles.pressed]}
              >
                <View style={[styles.chipDot, { backgroundColor: household ? colors.household : colors.accent }]} />
                <Text style={[styles.chipLabel, { color: household ? colors.householdText : colors.accentText }]}>
                  {household ? 'Household \u00B7 Shared' : 'Just me'}
                </Text>
              </Pressable>
              <View style={styles.flex} />
              <Pressable
                onPress={() => canvasStore.setPinned(canvas.id, !canvas.pinned)}
                hitSlop={{ top: 6, bottom: 6 }}
                accessibilityRole="button"
                accessibilityLabel={canvas.pinned ? 'Unpin from Home' : 'Pin to Home'}
                accessibilityState={{ selected: canvas.pinned }}
                style={({ pressed }) => [styles.pill, canvas.pinned && styles.pillOn, pressed && styles.pressed]}
              >
                <PinIcon size={16} color={canvas.pinned ? colors.white : colors.ink} />
                <Text style={[styles.pillLabel, canvas.pinned && styles.pillLabelOn]}>{canvas.pinned ? 'Pinned' : 'Pin'}</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => setRenameOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Title: ${canvas.title}. Tap to rename`}
            >
              <Text style={styles.title} accessibilityRole="header">
                {canvas.title}
              </Text>
            </Pressable>
            <Text style={styles.note} accessibilityRole="text">
              {refreshNote}
            </Text>
            <View style={styles.chipRow}>
              <LockToggle locked={canvas.locked} onPress={() => canvasStore.setLocked(canvas.id, !canvas.locked)} />
              <Pressable
                onPress={() => setAgentOpen(true)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Canvas agent: ${agentChipLabel(canvas)}`}
                accessibilityHint="Opens who runs this canvas"
                style={({ pressed }) => [styles.pill, styles.agentChip, pressed && styles.pressed]}
              >
                <Text style={styles.pillLabel} numberOfLines={1}>
                  {agentChipLabel(canvas)}
                </Text>
                <ChevronRightIcon size={14} color={colors.inkSecondary} />
              </Pressable>
            </View>
          </View>

          {canvas.blocks.length > 0 ? (
            <CanvasBlocks canvasId={canvas.id} blocks={canvas.blocks} editor={editor} onLockedTap={canvas.locked ? askAbout : undefined} />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>This canvas is empty</Text>
              <Text style={styles.note}>
                {canvas.locked ? 'Unlock it, then tell Ano what should be on it.' : 'Tell Ano what should be on it, below.'}
              </Text>
            </View>
          )}

        </ScrollView>

        {/* Ano reworks the whole canvas, so its progress sits above the composer, not under a long list. */}
        {editor.running ? (
          <View style={styles.activityBar}>
            <RunActivityRow activity={editor.activity} />
          </View>
        ) : null}
        {/* Errors sit here too: at the end of a long canvas nobody would see them. */}
        {editor.error && !editor.running ? (
          <View style={styles.errorNote}>
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {editor.error}
            </Text>
            <View style={styles.errorActions}>
              {canvas.agent.model ? (
                <Pressable
                  onPress={() => {
                    canvasStore.setAgent(canvas.id, { model: null });
                    editor.clearError();
                  }}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.errorAction}>Use default model</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={editor.clearError} accessibilityRole="button" accessibilityLabel="Dismiss error" hitSlop={8}>
                <Text style={styles.errorAction}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {toastVisible && undoToast.toast ? (
          <View style={styles.toastWrap} pointerEvents="box-none">
            <UndoToast message={undoToast.toast.summary} onUndo={undoToast.undo} />
          </View>
        ) : null}
        {canvas.locked ? (
          <LockedBar onUnlock={() => canvasStore.setLocked(canvas.id, false)} />
        ) : (
          <Composer
            onSend={(text) => void editor.send(text)}
            onStop={editor.stop}
            busy={editor.running}
            placeholder={'Change this canvas\u2026'}
            accessibilityLabel="Change this canvas"
          />
        )}
      </KeyboardAvoidingView>

      <RenameCanvasSheet
        visible={renameOpen}
        title={canvas.title}
        onClose={() => setRenameOpen(false)}
        onSave={(title) => {
          setRenameOpen(false);
          canvasStore.rename(canvas.id, title);
          undoToast.notify(`Renamed to ${title}`);
        }}
      />
      <VersionsSheet
        visible={versionsOpen}
        canvas={canvas}
        onClose={() => setVersionsOpen(false)}
        onRestore={(version) => {
          const restored = canvasStore.restore(canvas.id, version);
          if (restored) undoToast.notify(`Restored version ${version}`);
        }}
      />
      <CanvasAgentSheet canvas={agentOpen ? canvas : null} onClose={() => setAgentOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { height: 44, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLabel: { fontSize: 17, lineHeight: 22, color: colors.accent },
  pressed: { opacity: 0.7 },
  titleBlock: { gap: 8 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  chipHousehold: { backgroundColor: colors.householdTint },
  chipPrivate: { backgroundColor: colors.accentTint },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipLabel: { fontSize: 13, lineHeight: 16 },
  pill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.white,
  },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillLabel: { fontSize: 13, lineHeight: 16, fontWeight: '600', color: colors.ink },
  pillLabelOn: { color: colors.white },
  agentChip: { flexShrink: 1 },
  title: { fontFamily: fonts.rounded, fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.3, color: colors.ink },
  note: { fontSize: 15, lineHeight: 21, color: colors.inkSecondary },
  emptyCard: { backgroundColor: colors.white, borderRadius: radii.card, padding: 16, gap: 4 },
  emptyTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.ink },
  errorNote: { marginHorizontal: 16, marginBottom: 8, padding: 12, gap: 8, borderRadius: radii.group, backgroundColor: colors.accentTint },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.accentText },
  errorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
  errorAction: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.accentText },
  toastWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  activityBar: { paddingHorizontal: 16, paddingBottom: 6 },
  lockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.composerBorder,
  },
  lockedText: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.inkSecondary },
  unlock: { height: 44, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  unlockLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.white },
});
