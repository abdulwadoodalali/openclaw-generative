// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// A real OpenClawAgent with the generative UI hooks (createGenUiHooks, the same factory the app
// uses) against a fake gateway: catalog brief and delta on chat.send, fences to validated tool calls,
// definitions into the registry.
// Run: node --experimental-strip-types --test src/genui/integration.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawAgent } from '../openclaw/OpenClawAgent.ts';
import { CODE_BUILTINS } from './builtins/codeMeta.ts';
import { BUILTIN_DEFINITIONS } from './builtins/definitions.ts';
import { createGenUiHooks } from './hooks.ts';
import { DefinitionIngestor } from './historyIngest.ts';
import { ComponentRegistry } from './registry.ts';

const KEY = 'agent:main:dashboard:t1';

const fence = (info, value) => ['```' + info, JSON.stringify(value), '```'].join('\n');

const MONEY_GLANCE = { component: 'MoneyGlance', props: { month: 'October', spent: 2190, left: 410, sample: true, series: [12, 18, 24, 30] } };
const BUDGET_BAR_DEFINITION = {
  name: 'BudgetBar',
  version: 1,
  description: 'one category vs its budget',
  props: {
    type: 'object',
    required: ['label', 'spent', 'budget'],
    properties: { label: { type: 'string' }, spent: { type: 'number' }, budget: { type: 'number' } },
  },
  root: 'n1',
  nodes: { n1: { t: 'Card', children: ['n2'] }, n2: { t: 'Progress', value: '{{spent}}', max: '{{budget}}' } },
};

function memoryStorage() {
  const storage = {
    data: null,
    async load() {
      return storage.data;
    },
    async save(json) {
      storage.data = json;
    },
  };
  return storage;
}

/** chat.send replies with the next scripted text: one delta, then final. */
function scriptedGateway(replies) {
  const listeners = new Set();
  const calls = [];
  let turn = 0;
  const emit = (payload) => {
    for (const listener of [...listeners]) listener({ type: 'event', event: 'chat', payload });
  };
  const gateway = {
    async request(method, params = {}) {
      calls.push({ method, params });
      if (method !== 'chat.send') throw new Error(`unhandled ${method}`);
      const runId = `r${turn}`;
      const text = replies[turn];
      turn += 1;
      // Frames that arrive before the ack are queued by the run and replayed once the ack is in.
      emit({ runId, sessionKey: params.sessionKey, seq: 1, state: 'delta', deltaText: text, message: { role: 'assistant', content: [{ type: 'text', text }] } });
      emit({ runId, sessionKey: params.sessionKey, seq: 2, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text }] } });
      return { runId, status: 'started' };
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeStatus: () => () => undefined,
    getInfo: () => ({ status: 'ready', readyCount: 1 }),
  };
  return { gateway, calls };
}

async function sendAndWait(agent, id, text) {
  agent.addMessage({ id, role: 'user', content: text });
  await agent.runAgent();
  return agent.messages[agent.messages.length - 1];
}

const toolCallsOf = (message) => message.toolCalls ?? [];

test('brief, validated render calls, define, delta, and a render of the new component', async () => {
  const registry = new ComponentRegistry({ builtins: BUILTIN_DEFINITIONS, codeBuiltins: CODE_BUILTINS });
  const { hooks, tracker } = createGenUiHooks(registry, memoryStorage());
  await tracker.ready;
  const { gateway, calls } = scriptedGateway([
    ['Here is October.', fence('ano-ui', MONEY_GLANCE)].join('\n\n'),
    ['I made a new bar for that.', fence('ano-define', BUDGET_BAR_DEFINITION)].join('\n\n'),
    [
      'Groceries are close to the limit.',
      fence('ano-ui', { component: 'BudgetBar', props: { label: 'Groceries', spent: 380, budget: 450 } }),
      fence('ano-ui', { component: 'BudgetBar', props: { label: 'Dining' } }),
    ].join('\n\n'),
  ]);
  const agent = new OpenClawAgent(gateway, hooks);
  agent.threadId = KEY;

  // Turn 1: the first send carries the catalog brief, the reply's fence becomes a validated tool call.
  const first = await sendAndWait(agent, 'u1', 'budget this month');
  assert.ok(calls[0].params.message.startsWith('<ano-ui-context>'));
  assert.ok(calls[0].params.message.endsWith('budget this month'));
  assert.equal(agent.messages[0].content, 'budget this month', 'the visible user message is untouched');
  const [glance] = toolCallsOf(first);
  assert.equal(glance.function.name, 'render_MoneyGlance');
  assert.equal(JSON.parse(glance.function.arguments).spent, 2190);
  assert.equal(first.content.includes('ano-ui'), false);

  // Turn 2: plain text out, and the ano-define fence is a define_component call.
  const second = await sendAndWait(agent, 'u2', 'make a budget bar');
  assert.equal(calls[1].params.message, 'make a budget bar');
  const [define] = toolCallsOf(second);
  assert.equal(define.function.name, 'define_component');
  assert.equal(registry.get('BudgetBar'), undefined);
  const catalogVersion = registry.catalogVersion;
  new DefinitionIngestor(registry).ingestMessages(agent.messages);
  assert.ok(registry.get('BudgetBar'));
  assert.equal(registry.catalogVersion, catalogVersion + 1);

  // Turn 3: the next send carries the delta once; the reply's BudgetBar validates against the new definition.
  const third = await sendAndWait(agent, 'u3', 'and groceries?');
  assert.ok(calls[2].params.message.startsWith('[catalog-update]'));
  assert.ok(calls[2].params.message.includes('BudgetBar'));
  assert.ok(calls[2].params.message.endsWith('and groceries?'));
  const [good, bad] = toolCallsOf(third);
  assert.equal(good.function.name, 'render_BudgetBar');
  assert.deepEqual(JSON.parse(good.function.arguments), { label: 'Groceries', spent: 380, budget: 450 });
  assert.equal(bad.function.name, 'render_BudgetBar');
  const fallback = JSON.parse(bad.function.arguments);
  assert.equal(typeof fallback.__fallback, 'string');
  assert.ok(fallback.__error.length > 0);

  // Turn 4 would be plain again.
  assert.equal(hooks.decorateOutgoing('later', { sessionKey: KEY, firstMessage: false }), 'later');
});

test('history: user rows are cleaned, ui-events hidden, assistant rows keep their tool calls', async () => {
  const registry = new ComponentRegistry({ builtins: BUILTIN_DEFINITIONS, codeBuiltins: CODE_BUILTINS });
  const { hooks, tracker } = createGenUiHooks(registry, memoryStorage());
  await tracker.ready;
  const decorated = hooks.decorateOutgoing('budget this month', { sessionKey: KEY, firstMessage: true });
  const history = {
    messages: [
      { role: 'user', content: decorated },
      { role: 'assistant', content: [{ type: 'text', text: ['Here.', fence('ano-ui', MONEY_GLANCE)].join('\n\n') }] },
      { role: 'user', content: '[ui-event] {"component":"Suggestions","event":"pick","text":"By category"}' },
    ],
  };
  const listeners = new Set();
  const gateway = {
    async request(method) {
      if (method === 'chat.history') return history;
      throw new Error(`unhandled ${method}`);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeStatus: () => () => undefined,
    getInfo: () => ({ status: 'ready', readyCount: 1 }),
  };
  const agent = new OpenClawAgent(gateway, hooks);
  await agent.openThread(KEY);
  assert.equal(agent.messages.length, 2);
  assert.equal(agent.messages[0].content, 'budget this month');
  assert.equal(toolCallsOf(agent.messages[1])[0].function.name, 'render_MoneyGlance');
});
