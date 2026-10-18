// The settings sheet plus its first-launch behaviour. With nothing stored the one-time setup sheet
// opens by itself and closes again once the gateway accepted this device (pairing approved). Home and
// Chat are mounted together in the pager, so only the caller passing `autoOpen` (Home) does that;
// otherwise both would open a sheet on first launch.
import React, { useEffect, useRef, useState } from 'react';
import { SettingsSheet } from '../components/SettingsSheet';
import { useAno } from '../state/AnoProvider';

export function useSettingsSheet({ autoOpen = false }: { autoOpen?: boolean } = {}): { open: () => void; sheet: React.ReactElement } {
  const ano = useAno();
  const [visible, setVisible] = useState(false);
  const setupOpened = useRef(false);
  const { connection } = ano;

  useEffect(() => {
    if (autoOpen && ano.needsSetup && ano.settingsLoaded && !setupOpened.current) {
      setupOpened.current = true;
      setVisible(true);
    }
  }, [autoOpen, ano.needsSetup, ano.settingsLoaded]);
  useEffect(() => {
    if (setupOpened.current && connection.status === 'ready') {
      setupOpened.current = false;
      setVisible(false);
    }
  }, [connection.status]);

  const sheet = (
    <SettingsSheet
      visible={visible}
      onClose={() => setVisible(false)}
      settings={ano.settings}
      connection={connection}
      paired={ano.paired}
      setup={ano.needsSetup}
      pairing={ano.pairing}
      onAutoPair={ano.pairAutomatically}
      onSave={ano.saveSettingsAndConnect}
      onReconnect={ano.reconnect}
      onResetPairing={ano.resetPairing}
    />
  );
  return { open: () => setVisible(true), sheet };
}
