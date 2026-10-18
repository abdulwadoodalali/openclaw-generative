// The gateway's agents for the chat UI (header, agent sheet, sidebar faces). Loads once the gateway
// is connected (cached 5 minutes in src/chat/agents.ts). `agentFor` never returns undefined, so a
// face can draw before the list arrives or for an agent the gateway no longer lists.
import { useCallback, useEffect, useState } from 'react';
import { loadAgents, type AgentOption } from '../../chat/agents';
import { useAno } from '../../state/AnoProvider';

export function useAgents(): { agents: AgentOption[]; agentFor: (id: string) => AgentOption } {
  const { gateway, connection } = useAno();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const ready = connection.status === 'ready';

  useEffect(() => {
    if (!ready) return;
    let live = true;
    loadAgents((m, p) => gateway.request(m, p))
      .then((list) => live && setAgents(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [gateway, ready, connection.readyCount]);

  const agentFor = useCallback(
    (id: string): AgentOption =>
      agents.find((a) => a.id === id) ?? {
        id,
        name: id,
        initial: (id.replace(/^ano-/, '').charAt(0) || '?').toUpperCase(),
        hint: '',
        thinkingLevels: [],
        thinkingDefault: null,
        defaultModel: null,
      },
    [agents],
  );

  return { agents, agentFor };
}
