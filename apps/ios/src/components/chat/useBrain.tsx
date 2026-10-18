// The composer's brain chip plus its sheet, in one hook so Chat and Home share them.
//   scope 'chat'     the chip shows and changes the open chat (and becomes the default for new chats)
//   scope 'defaults' the chip shows and changes what new chats start with (Home: a send starts a new chat)
// With `onSendOnce` set, long-press on send opens the sheet "For this message only" and a tap on a
// tile sends that message with that brain, leaving the chat's own setting alone.
import React, { useState } from 'react';
import { useAno, useChat, type PickedImage } from '../../state/AnoProvider';
import type { Effort } from '../../chat/effort';
import type { ComposerBrain } from '../Composer';
import { BrainSheet } from './BrainSheet';
import { chipLabel, useQuickPicks } from './brain';
import { useAgents } from './useAgents';

export type SendOnce = (text: string, images: PickedImage[], once: { model: string | null; effort: Effort | null }) => void;

export function useBrain({ scope, onSendOnce }: { scope: 'chat' | 'defaults'; onSendOnce?: SendOnce }): {
  brain: ComposerBrain;
  sheet: React.ReactElement;
} {
  const chat = useChat();
  const { threads, threadsStore } = useAno();
  const { agentFor } = useAgents();
  const [mode, setMode] = useState<'chat' | 'message' | null>(null);
  const [pending, setPending] = useState<{ text: string; images: PickedImage[] } | null>(null);

  const prefs = scope === 'chat' ? chat.prefs : threads.defaults;
  const agent = agentFor(prefs.agentId);
  const { models, picks } = useQuickPicks(agent.defaultModel);

  const close = () => {
    setMode(null);
    setPending(null);
  };

  const setModel = (model: string | null) => (scope === 'chat' ? chat.setModel(model) : Promise.resolve(threadsStore.setDefaults({ model })));
  const setEffort = (effort: Effort | null) => (scope === 'chat' ? chat.setEffort(effort) : Promise.resolve(threadsStore.setDefaults({ effort })));

  const brain: ComposerBrain = {
    label: chipLabel(picks, prefs, agent.defaultModel),
    onPress: () => setMode('chat'),
    onLongPressSend: onSendOnce
      ? (text, images) => {
          setPending({ text, images });
          setMode('message');
        }
      : undefined,
  };

  const sheet = (
    <BrainSheet
      visible={mode !== null}
      onClose={close}
      mode={mode ?? 'chat'}
      prefs={prefs}
      agentDefaultModel={agent.defaultModel}
      models={models}
      picks={picks}
      onPick={(pick) => {
        if (mode === 'message' && pending && onSendOnce) onSendOnce(pending.text, pending.images, { model: pick.model, effort: pick.effort });
        else void setModel(pick.model).then(() => setEffort(pick.effort));
        close();
      }}
      onModel={(model) => void setModel(model)}
      onEffort={(effort) => void setEffort(effort)}
    />
  );

  return { brain, sheet };
}
