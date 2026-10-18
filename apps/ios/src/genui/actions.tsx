// Where taps inside generated components go. By default a Suggestions chip is sent as a normal
// user message and every other action becomes a `[ui-event]` turn (see formatUiEvent). A screen
// can mount <UiActionProvider> to take over (the demo thread does, to feed its own agent).
import React, { createContext, useContext, useMemo } from 'react';
import { useChat } from '../state/AnoProvider';
import { formatUiEvent } from './catalog.ts';
import type { UiActionHandler } from './types.ts';

/** The send functions a chat host exposes (useChat() satisfies this). */
export type UiActionTarget = {
  send(text: string): unknown;
  sendUiEvent(text: string): unknown;
};

export function createChatUiActionHandler(api: UiActionTarget): UiActionHandler {
  return (action) => {
    if (action.component === 'Suggestions' && action.name === 'pick' && typeof action.payload.text === 'string') {
      void api.send(action.payload.text);
      return;
    }
    void api.sendUiEvent(formatUiEvent({ component: action.component, event: action.name, payload: action.payload }));
  };
}

const UiActionContext = createContext<UiActionHandler | null>(null);

export function UiActionProvider({ handler, children }: { handler: UiActionHandler; children: React.ReactNode }) {
  return <UiActionContext.Provider value={handler}>{children}</UiActionContext.Provider>;
}

/** The handler of the nearest <UiActionProvider>, else the default chat handler. */
export function useUiActionHandler(): UiActionHandler {
  const override = useContext(UiActionContext);
  const chat = useChat();
  return useMemo(() => override ?? createChatUiActionHandler({ send: chat.send, sendUiEvent: chat.sendUiEvent }), [override, chat.send, chat.sendUiEvent]);
}
