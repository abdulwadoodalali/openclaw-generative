// A 40pt strip above Home's composer when the gateway is not reachable: what is wrong, a bold Retry
// and a Settings link. Nothing shows while connecting or connected.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConnectionStatus } from '../../openclaw/gatewayConnection';
import { colors } from '../../theme';

const MESSAGE: Partial<Record<ConnectionStatus, string>> = {
  idle: 'Not connected',
  reconnecting: 'Gateway offline',
  error: 'Gateway offline',
  'auth-failed': 'Not authorised',
  'needs-pairing': 'Waiting for approval',
};


export type ConnectionStripProps = {
  status: ConnectionStatus;
  onRetry: () => void;
  onOpenSettings: () => void;
};

export function ConnectionStrip({ status, onRetry, onOpenSettings }: ConnectionStripProps) {
  const message = MESSAGE[status];
  if (!message) return null;
  return (
    <View style={styles.strip} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Retry connecting"
      >
        <Text style={styles.action}>Retry</Text>
      </Pressable>
      <Pressable
        onPress={onOpenSettings}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
        accessibilityRole="link"
        accessibilityLabel="Open Settings"
      >
        <Text style={styles.link}>Settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: 40,
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.accentTint,
  },
  message: { flex: 1, fontSize: 13, lineHeight: 16, color: colors.accentText },
  action: { fontSize: 13, lineHeight: 16, fontWeight: '700', color: colors.accentText },
  link: { fontSize: 13, lineHeight: 16, color: colors.accentText, textDecorationLine: 'underline' },
});
