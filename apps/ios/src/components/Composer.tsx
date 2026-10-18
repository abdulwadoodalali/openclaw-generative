// The composer card, shared by Chat, Home and the canvas screen. A white card (radius 22, hairline
// border) with an auto-growing field. Chat turns on more: `allowImages` adds the "+" menu (photo
// library, camera) with a thumbnail strip, and `brain` adds the chip that says how Ano thinks.
// Send is amber when there is something to send, stop shows while a run is going and the field is
// empty. Long-press on send (when `brain.onLongPressSend` is set) offers a per-message brain.
// Queued messages and the error strip are drawn by the screen above this card.
// A draft is only cleared by sending it: it survives stop, errors and a closed sheet.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Image, PixelRatio, Platform, Pressable, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { orbSignal } from '../orb/orbStore';
import type { PickedImage } from '../state/AnoProvider';
import { colors, fonts, radii, shadows } from '../theme';
import { AttachSheet } from './chat/AttachSheet';
import { tapLight, tapMedium } from './chat/haptics';
import { ChevronDownIcon } from './chat/icons';
import { MAX_IMAGES, pickImages } from './chat/pickImages';
import { PlusIcon, ArrowUpIcon, StopIcon, XIcon } from './Icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type ComposerBrain = {
  /** Quick, Balanced, Deep, or "Sonnet 5.5 · Max". */
  label: string;
  onPress: () => void;
  /** Long-press on send: the text and photos to send, for the caller to send with a one-off brain. */
  onLongPressSend?: (text: string, images: PickedImage[]) => void;
};

export type ComposerProps = {
  onSend: (text: string, images: PickedImage[]) => void;
  onStop?: () => void;
  busy?: boolean;
  /** Locks the whole input. */
  disabled?: boolean;
  /** Lets the user type but blocks sending (for example while the gateway is not connected). */
  sendDisabled?: boolean;
  placeholder?: string;
  /** Accessibility label of the field. Default "Message Ano". */
  accessibilityLabel?: string;
  /** Shows the "+" menu and thumbnails. */
  allowImages?: boolean;
  /** Shows the brain chip. */
  brain?: ComposerBrain;
  /** Told whenever the field gains or loses a draft (text or photos). */
  onHasDraft?: (hasDraft: boolean) => void;
};

export type ComposerHandle = {
  /** Puts text (and photos) back in the field, for "Edit" and a dequeued message. */
  setDraft: (text: string, images?: PickedImage[]) => void;
  clear: () => void;
  focus: () => void;
};

const LINE = 22;
/** Height of the fade above the composer; scrolling screens keep at least this much extra room below their content. */
export const COMPOSER_FADE = 20;
const MAX_LINES = 6;
/** Larger Dynamic Type grows the field, up to this factor, so the card never crowds the screen. */
const MAX_FONT_SCALE = 1.35;
/** Gap left under the card while the keyboard is up (the home-indicator space is under the keyboard then). */
const KEYBOARD_GAP = 8;

/** Bottom padding under the card: the home-indicator area, or a small margin. */
function bottomPadding(insetBottom: number): number {
  return Math.max(insetBottom, Platform.OS === 'web' ? 24 : 12);
}

/**
 * `keyboardVerticalOffset` for the KeyboardAvoidingView that holds a Composer. The card keeps one fixed
 * bottom padding (no state change when the keyboard moves, which made the card jump against the
 * keyboard animation); this offset takes that padding back out while the keyboard is up, so the card
 * sits KEYBOARD_GAP above it in a single animation.
 */
export function useComposerKeyboardOffset(): number {
  const insets = useSafeAreaInsets();
  return -(bottomPadding(insets.bottom) - KEYBOARD_GAP);
}

/** The DOM textarea behind a multiline TextInput on react-native-web. */
type WebTextArea = { scrollHeight: number; style: { height: string } };
function isWebTextArea(node: unknown): node is WebTextArea {
  return typeof node === 'object' && node !== null && 'scrollHeight' in node && 'style' in node;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    onSend,
    onStop,
    busy = false,
    disabled = false,
    sendDisabled = false,
    placeholder = 'Message Ano',
    accessibilityLabel = 'Message Ano',
    allowImages = false,
    brain,
    onHasDraft,
  },
  ref,
) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [fieldHeight, setFieldHeight] = useState(LINE);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  useImperativeHandle(
    ref,
    () => ({
      setDraft: (next, nextImages) => {
        // An existing draft is never lost: the restored text goes after it.
        setText((current) => (current.trim() ? `${current}\n${next}` : next));
        if (nextImages && nextImages.length > 0) setImages((current) => [...current, ...nextImages].slice(0, MAX_IMAGES));
        inputRef.current?.focus();
      },
      clear: () => {
        setText('');
        setImages([]);
        setFieldHeight(LINE);
      },
      focus: () => inputRef.current?.focus(),
    }),
    [],
  );

  const paddingBottom = bottomPadding(insets.bottom);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(timer);
  }, [note]);

  // The orb listens while this field has focus; a screen that unmounts mid-typing sends no blur.
  const focused = useRef(false);
  useEffect(
    () => () => {
      if (focused.current) orbSignal({ type: 'blur' });
    },
    [],
  );

  const trimmed = text.trim();
  const hasContent = trimmed.length > 0 || images.length > 0;
  useEffect(() => onHasDraft?.(hasContent), [hasContent, onHasDraft]);
  const canSend = !disabled && !sendDisabled && hasContent;
  const showStop = busy && onStop !== undefined && !hasContent;
  const footer = allowImages || brain !== undefined;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    void tapLight();
    orbSignal({ type: 'send' });
    onSend(trimmed, images);
    setText('');
    setImages([]);
    setFieldHeight(LINE);
  }, [canSend, images, onSend, trimmed]);

  const handleLongPress = () => {
    if (!canSend || !brain?.onLongPressSend) return;
    void tapMedium();
    brain.onLongPressSend(trimmed, images);
  };

  const attach = (source: 'library' | 'camera') => {
    setAttachOpen(false);
    // iOS cannot present the picker while the sheet is still sliding away.
    setTimeout(
      async () => {
        const result = await pickImages(source, MAX_IMAGES - images.length);
        if (result.images.length > 0) setImages((current) => [...current, ...result.images].slice(0, MAX_IMAGES));
        setNote(result.note);
      },
      Platform.OS === 'web' ? 0 : 400,
    );
  };

  // Native: the field grows by itself between minHeight and maxHeight (no measured height, which fed
  // back into itself and made the box jitter, worse with larger text). The web textarea cannot grow by
  // itself, so there the height is measured from the DOM (collapse, read, restore).
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const node: unknown = inputRef.current;
    if (!isWebTextArea(node)) return;
    const previous = node.style.height;
    node.style.height = '0px';
    const content = node.scrollHeight - 2 * INPUT_PAD;
    node.style.height = previous;
    setFieldHeight(Math.min(Math.max(content, LINE), LINE * MAX_LINES));
  }, [text]);
  const fontScale = Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE);
  const fieldSize: TextStyle =
    Platform.OS === 'web'
      ? { height: fieldHeight + 2 * INPUT_PAD }
      : { minHeight: Math.ceil(LINE * fontScale) + 2 * INPUT_PAD, maxHeight: Math.ceil(LINE * fontScale * MAX_LINES) + 2 * INPUT_PAD };

  // On the web the multiline field would swallow Enter; Enter sends, Shift+Enter adds a line.
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web' || e.nativeEvent.key !== 'Enter') return;
    const shift = 'shiftKey' in e.nativeEvent && e.nativeEvent.shiftKey === true;
    if (shift) return;
    e.preventDefault();
    handleSend();
  };

  const webInputStyle = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

  const sendButton = showStop ? (
    <Pressable
      onPress={onStop}
      accessibilityLabel="Stop"
      accessibilityRole="button"
      style={({ pressed }) => [styles.send, styles.stopButton, pressed && styles.pressed]}
    >
      <StopIcon size={20} color={colors.white} />
    </Pressable>
  ) : (
    <Pressable
      onPress={handleSend}
      onLongPress={brain?.onLongPressSend ? handleLongPress : undefined}
      delayLongPress={350}
      disabled={!canSend}
      accessibilityLabel={busy ? 'Queue message' : 'Send'}
      accessibilityHint={brain?.onLongPressSend ? 'Hold to choose how Ano thinks for this message' : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: !canSend }}
      style={({ pressed }) => [styles.send, canSend ? styles.sendReady : styles.sendEmpty, pressed && canSend && styles.pressed]}
    >
      <ArrowUpIcon size={20} color={canSend ? colors.white : colors.inkTertiary} />
    </Pressable>
  );

  const field = (
    <TextInput
      ref={inputRef}
      style={[styles.input, footer ? styles.inputFull : styles.inputInline, fieldSize, webInputStyle]}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      placeholder={placeholder}
      placeholderTextColor={colors.inkSecondary}
      value={text}
      onChangeText={(next) => {
        setText(next);
        orbSignal({ type: 'keystroke' });
      }}
      onFocus={() => {
        focused.current = true;
        orbSignal({ type: 'focus' });
      }}
      onBlur={() => {
        focused.current = false;
        orbSignal({ type: 'blur' });
      }}
      onKeyPress={onKeyPress}
      multiline
      scrollEnabled={Platform.OS !== 'web' || fieldHeight >= LINE * MAX_LINES}
      editable={!disabled}
      accessibilityLabel={accessibilityLabel}
    />
  );

  return (
    <View style={[styles.container, { paddingBottom }]}>
      {/* A functional scrim (not decoration): content scrolling under the composer fades out instead of ending on a hard line. */}
      <View style={styles.fade} pointerEvents="none">
        <Svg width="100%" height={COMPOSER_FADE}>
          <Defs>
            <LinearGradient id="composerFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={COMPOSER_FADE} fill="url(#composerFade)" />
        </Svg>
      </View>
      {note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
      <View style={styles.card}>
        {images.length > 0 ? (
          <View style={styles.strip}>
            {images.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={styles.thumbWrap}>
                <Image source={{ uri: image.uri }} style={styles.thumb} accessibilityLabel={`Photo ${index + 1}`} />
                <Pressable
                  onPress={() => setImages((current) => current.filter((_, i) => i !== index))}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1}`}
                  style={styles.thumbRemove}
                >
                  <XIcon size={12} color={colors.white} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {footer ? (
          <>
            {field}
            <View style={styles.footer}>
              {allowImages ? (
                <Pressable
                  onPress={() => setAttachOpen(true)}
                  disabled={disabled || images.length >= MAX_IMAGES}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo"
                  style={({ pressed }) => [styles.plus, (disabled || images.length >= MAX_IMAGES) && styles.dimmed, pressed && styles.pressed]}
                >
                  <PlusIcon size={22} color={colors.ink} />
                </Pressable>
              ) : null}
              <View style={styles.spacer} />
              {brain ? (
                <Pressable
                  onPress={brain.onPress}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={`How Ano thinks: ${brain.label}`}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                >
                  <Text style={styles.chipLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                    {brain.label}
                  </Text>
                  <ChevronDownIcon size={12} color={colors.inkSecondary} />
                </Pressable>
              ) : null}
              {sendButton}
            </View>
          </>
        ) : (
          <View style={styles.inlineRow}>
            {field}
            {sendButton}
          </View>
        )}
      </View>

      {allowImages ? <AttachSheet visible={attachOpen} onClose={() => setAttachOpen(false)} onPick={attach} /> : null}
    </View>
  );
});

const INPUT_PAD = 11;

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 8, backgroundColor: colors.bg, gap: 6 },
  card: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    ...shadows.button,
  },
  input: { fontSize: 16, lineHeight: LINE, color: colors.ink, paddingVertical: INPUT_PAD, fontFamily: fonts.body },
  inputFull: { paddingHorizontal: 16 },
  inputInline: { flex: 1, paddingLeft: 16, paddingRight: 4 },
  inlineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 3, paddingBottom: 3 },
  spacer: { flex: 1 },
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chip: { height: 32, maxWidth: 190, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.fill },
  chipLabel: { flexShrink: 1, fontSize: 13, lineHeight: 16, fontWeight: '600', color: colors.ink },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendReady: { backgroundColor: colors.accent },
  sendEmpty: { backgroundColor: colors.fill },
  stopButton: { backgroundColor: colors.ink },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.fill },
  thumbRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary, textAlign: 'center' },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.4 },
  fade: { position: 'absolute', left: 0, right: 0, top: -COMPOSER_FADE, height: COMPOSER_FADE },
});
