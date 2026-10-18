// "Ask in a new chat": starts a fresh thread, sends `text`, and brings the chat page to the front.
// From a screen above Home (a canvas, the canvas list) it also returns to Home first, since the
// chat page lives next to Home in the pager.
import { useCallback } from 'react';
import { router, usePathname } from 'expo-router';
import { showChat } from '../lib/pager';
import { useChat, type ChatApi } from '../state/AnoProvider';

/** What `send` takes after the text (a one-off brain, images). */
type SendOptions = Parameters<ChatApi['send']>[1];

export function useAskInChat() {
  const chat = useChat();
  const pathname = usePathname();
  const { newThread, send, agent } = chat;

  /** Brings the chat page to the front without starting anything. */
  const openChat = useCallback(() => {
    showChat();
    if (pathname === '/') return;
    // Back to the pager (Home + Chat): pops to it when it is under this screen, replaces otherwise
    // (a deep link straight into /canvases has no Home underneath).
    router.dismissTo('/');
  }, [pathname]);

  const ask = useCallback(
    async (text: string, opts?: SendOptions) => {
      newThread(null);
      openChat();
      // A reply still streaming in the old thread is detached asynchronously; `send` refuses while
      // the agent reports a run, so wait for the detach (bounded) instead of dropping the question.
      for (let waited = 0; agent.isRunning && waited < 3000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await send(text, opts);
    },
    [agent, newThread, openChat, send],
  );

  return { ask, openChat };
}
