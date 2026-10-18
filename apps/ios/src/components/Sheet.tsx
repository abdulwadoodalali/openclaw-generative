// Bottom sheet shell on the plain RN Modal (works in Expo Go and on web, no extra native deps).
// Warm sheet surface, 32px top corners, a grab handle, backdrop tap to close and keyboard
// avoidance. Content scrolls inside. Used by the settings sheet and the threads sheet.
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii } from '../theme';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Fixed header rendered above the scrolling content (title row). */
  header?: React.ReactNode;
  /** Fixed footer pinned under the scrolling content (primary actions stay on screen). */
  footer?: React.ReactNode;
  /** Fraction of the window height the sheet may use. Default 0.88. */
  maxHeightFraction?: number;
  contentStyle?: StyleProp<ViewStyle>;
  /** Accessibility label for the dialog. */
  label?: string;
};

export function Sheet({
  visible,
  onClose,
  children,
  header,
  footer,
  maxHeightFraction = 0.88,
  contentStyle,
  label,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // react-native-web keeps a closed Modal's dialog in the DOM; render nothing instead, so hidden sheets cannot duplicate inputs.
  if (Platform.OS === 'web' && !visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss sheet" accessibilityRole="button" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            accessibilityLabel={label}
            style={[
              styles.sheet,
              {
                maxHeight: Math.round(windowHeight * maxHeightFraction),
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={styles.handle} />
            {header}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.content, contentStyle]}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  kav: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceSheet,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    overflow: 'hidden',
    // Warm shadow, never grey.
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 4,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 16 },
});
