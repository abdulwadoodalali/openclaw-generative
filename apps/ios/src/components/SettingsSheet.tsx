// Settings sheet for gateway connection configuration.
// Presentational only: state lives in the parent, with local draft state
// initialised from props each time the sheet opens.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import { SIMULATOR_URL, type Settings } from '@/config';
import { ENV_OPENCLAW_URL } from '@/env';
import { useAgents } from '@/components/chat/useAgents';
import { pairingCommands } from '@/connectPolicy';
import type { ConnectionInfo, ConnectionStatus } from '@/openclaw/gatewayConnection';
import { Sheet } from '@/components/Sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { colors, shadows } from '@/theme';

export type SettingsSheetProps = {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  connection: ConnectionInfo;
  paired: boolean;
  /** First launch, nothing stored: show the one-time connect form (URL prefilled, token focused). */
  setup?: boolean;
  /** Automatic discovery + pairing state, for the failure message and the "Try again" button. */
  pairing?: { phase: 'idle' | 'running' | 'failed'; message?: string };
  onAutoPair?: () => void | Promise<unknown>;
  onSave: (settings: Settings, gatewayToken: string | undefined) => void | Promise<void>;
  onReconnect: () => void;
  onResetPairing: () => void | Promise<void>;
};

function getStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'ready':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'needs-pairing':
      return 'Waiting for approval';
    case 'auth-failed':
      return 'Not authorised';
    case 'error':
      return 'Not connected';
    case 'idle':
    default:
      return 'Not connected';
  }
}

function getDotStyle(status: ConnectionStatus): ViewStyle {
  switch (status) {
    case 'ready':
      return { backgroundColor: colors.accent };
    case 'connecting':
    case 'reconnecting':
    case 'needs-pairing':
      return { backgroundColor: colors.accent, opacity: 0.45 };
    case 'auth-failed':
    case 'error':
      return { backgroundColor: colors.danger };
    case 'idle':
    default:
      return { backgroundColor: colors.inkTertiary };
  }
}

export function SettingsSheet({
  visible,
  onClose,
  settings,
  connection,
  paired,
  setup = false,
  pairing,
  onAutoPair,
  onSave,
  onReconnect,
  onResetPairing,
}: SettingsSheetProps) {
  // Local form state
  const [url, setUrl] = useState(settings.url);
  const [agentId, setAgentId] = useState(settings.agentId);
  // The gateway's agents (agents.list); the saved one stays listed while offline or if it vanished.
  const { agents, agentFor } = useAgents();
  const agentChoices = agents.some((a) => a.id === agentId) ? agents : [agentFor(agentId), ...agents];
  const [token, setToken] = useState('');
  const tokenRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // Async action state
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Pairing reset two-step confirmation
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  // Re-initialise local draft state whenever visible turns true
  useEffect(() => {
    if (visible) {
      setUrl(settings.url);
      setAgentId(settings.agentId);
      setToken('');
      setConfirmingReset(false);
      clearResetTimer();
      // Setup mode: put the cursor in the token field once the slide-in animation settled.
      if (setup) {
        const t = setTimeout(() => tokenRef.current?.focus(), 400);
        return () => clearTimeout(t);
      }
    } else {
      setConfirmingReset(false);
      clearResetTimer();
    }
  }, [visible, settings.url, settings.agentId, setup]);

  // Clean up any pending confirmation timer on unmount
  useEffect(() => {
    return () => {
      clearResetTimer();
    };
  }, []);

  const handleResetPairing = useCallback(async () => {
    if (confirmingReset) {
      clearResetTimer();
      setConfirmingReset(false);
      try {
        setResetting(true);
        await onResetPairing();
      } finally {
        setResetting(false);
      }
    } else {
      setConfirmingReset(true);
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        setConfirmingReset(false);
        resetTimerRef.current = null;
      }, 4000);
    }
  }, [confirmingReset, onResetPairing]);

  const handleSave = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const trimmedToken = token.trim() || undefined;
    try {
      setSaving(true);
      await onSave({ url: trimmedUrl, agentId }, trimmedToken);
      // Setup stays open to show "Waiting for approval"; the screen closes it once connected.
      if (!setup) onClose();
    } finally {
      setSaving(false);
    }
  }, [url, agentId, token, onSave, onClose, setup]);

  const dotStyle = useMemo(() => getDotStyle(connection.status), [connection.status]);
  const statusLabel = useMemo(() => getStatusLabel(connection.status), [connection.status]);

  const headerElement = (
    <View className="flex-row items-center justify-between px-4 pb-2">
      <Text variant="title">{setup ? 'Connect to Ano' : 'Settings'}</Text>
      <Button variant="ghost" size="default" onPress={onClose} accessibilityLabel="Close settings">
        Done
      </Button>
    </View>
  );

  return (
    <Sheet
      label="Connection panel"
      visible={visible}
      onClose={onClose}
      header={headerElement}
      footer={
        setup ? (
          <Button
            variant="default"
            disabled={!url.trim() || !token.trim() || saving}
            loading={saving}
            onPress={handleSave}
          >
            Connect
          </Button>
        ) : (
          <View className="flex-row items-center gap-3">
            <Button variant="secondary" className="flex-1" onPress={onReconnect}>
              Reconnect
            </Button>
            <Button
              variant="default"
              className="flex-[1.4]"
              disabled={!url.trim() || saving}
              loading={saving}
              onPress={handleSave}
            >
              Save and connect
            </Button>
          </View>
        )
      }
    >
      {/* 1. Status card */}
      <View
        className="rounded-group bg-card p-4 border border-border"
        style={shadows.card}
      >
        <View className="flex-row items-center gap-2.5">
          <View style={[{ width: 8, height: 8, borderRadius: 4 }, dotStyle]} />
          <View className="flex-row items-baseline gap-2 flex-wrap">
            <Text className="text-[16px] leading-[22px] font-semibold text-foreground">
              {statusLabel}
            </Text>
            {connection.status === 'ready' && connection.serverVersion ? (
              <Text variant="secondary">{connection.serverVersion}</Text>
            ) : null}
          </View>
        </View>

        {connection.detail ? (
          <Text variant="secondary" className="mt-1.5 pl-[18px]">
            {connection.detail.replace('in Settings', 'below')}
          </Text>
        ) : null}

        {connection.status === 'needs-pairing' ? (
          <View className="mt-3 rounded-[10px] bg-secondary p-3 border border-border">
            <Text selectable variant="mono" className="text-foreground">
              {pairingCommands(connection.pairingRequestId).join('\n')}
            </Text>
            <Text selectable variant="secondary" className="mt-2 text-ink-secondary">
              Waiting for approval. Run these on the Mac that hosts Ano. This phone keeps retrying and connects by itself once approved.
            </Text>
          </View>
        ) : null}
      </View>

      {setup || !paired ? (
        <>
          <Separator />
          <View className="gap-2">
            <Text variant="label">Automatic pairing</Text>
            <Text variant="secondary">
              {pairing?.phase === 'running'
                ? 'Looking for Ano on your Tailscale network...'
                : pairing?.message ?? 'Ano finds your Mac on Tailscale and pairs this phone by itself.'}
            </Text>
            {onAutoPair ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={pairing?.phase === 'running'}
                loading={pairing?.phase === 'running'}
                onPress={() => void onAutoPair()}
              >
                Try again
              </Button>
            ) : null}
          </View>
        </>
      ) : null}

      {setup ? (
        <>
          <Separator />
          <View className="gap-2">
            <Text variant="label">Or paste the gateway token (last resort)</Text>
            <Input
              ref={tokenRef}
              value={token}
              onChangeText={setToken}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleSave}
              placeholder="Paste the gateway token"
              accessibilityLabel="Gateway token"
            />
            <Text variant="secondary">
              Only if automatic pairing cannot reach your Mac. Ano pairs this phone and keeps its own key, so next time it connects by itself. On the Mac run: openclaw gateway auth-token --show
            </Text>
          </View>
          <View className="gap-2">
            <Text variant="label">Gateway</Text>
            <Input
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="wss://your-mac.tailnet.ts.net"
              accessibilityLabel="Gateway URL"
            />
          </View>
        </>
      ) : (
        <>
          <Separator />

      {/* 2. Section: Gateway */}
      <View className="gap-2">
        <Text variant="label">Gateway</Text>
        <Input
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="wss://your-mac.tailnet.ts.net"
          accessibilityLabel="Gateway URL"
        />
        <View className="flex-row gap-2 mt-1">
          <Button variant="outline" size="sm" onPress={() => setUrl(SIMULATOR_URL)}>
            This Mac
          </Button>
          {ENV_OPENCLAW_URL && ENV_OPENCLAW_URL !== SIMULATOR_URL ? (
            <Button variant="outline" size="sm" onPress={() => setUrl(ENV_OPENCLAW_URL ?? SIMULATOR_URL)}>
              Tailscale
            </Button>
          ) : null}
        </View>
      </View>

      <Separator />

      {/* 3. Section: Agent */}
      <View className="gap-2">
        <Text variant="label">Agent</Text>
        <View className="flex-row flex-wrap bg-secondary rounded-[10px] p-[2px]">
          {agentChoices.map((agent) => {
            const isSelected = agentId === agent.id;
            return (
              <Pressable
                key={agent.id}
                onPress={() => setAgentId(agent.id)}
                accessibilityRole="button"
                accessibilityLabel={`Agent ${agent.name}`}
                accessibilityState={{ selected: isSelected }}
                className={cn(
                  'flex-grow h-8 px-3 items-center justify-center rounded-[8px]',
                  isSelected ? 'bg-card' : 'bg-transparent'
                )}
                style={isSelected ? shadows.button : undefined}
              >
                <Text
                  className={cn(
                    'text-[13px] leading-[16px]',
                    isSelected
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {agent.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Separator />

      {/* 4. Section: Pairing */}
      <View className="gap-2">
        <Text variant="label">Pairing</Text>
        {paired ? (
          <View className="flex-row items-center justify-between">
            <Badge variant="sage">This device is paired</Badge>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive"
              onPress={handleResetPairing}
              loading={resetting}
            >
              <Text className="text-destructive text-[13px] font-medium">
                {confirmingReset ? 'Tap again to confirm' : 'Reset pairing'}
              </Text>
            </Button>
          </View>
        ) : (
          <View className="gap-1.5">
            <Input
              value={token}
              onChangeText={setToken}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Gateway token, needed to pair"
              accessibilityLabel="Gateway token"
            />
            <Text variant="secondary">
              Paste the gateway token to pair this device. On the Mac run: openclaw gateway auth-token --show. Ano keeps a per-device key and forgets the token after pairing.
            </Text>
          </View>
        )}
      </View>
        </>
      )}

    </Sheet>
  );
}
