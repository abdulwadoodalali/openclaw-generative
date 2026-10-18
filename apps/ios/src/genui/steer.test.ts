// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// OpenClawAgent.steer: a message sent while a run is streaming goes out as chat.send with
// queueMode "steer" and the active run keeps being followed.
// Run: node --experimental-strip-types --test src/genui/steer.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawAgent } from '../openclaw/OpenClawAgent.ts';

const KEY = 'agent:main:dashboard:t1';

function fakeGateway() {
  const listeners = new Set();
  const calls = [];
  const gateway = {
    async request(method, params = {}) {
      calls.push({ method, params });
      if (method === 'chat.send') return { runId: 'r1', status: 'started' };
      return {};
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeStatus: () => () => undefined,
    getInfo: () => ({ status: 'ready', readyCount: 1 }),
  };
  const emit = (payload) => {
    for (const listener of [...listeners]) listener({ type: 'event', event: 'chat', payload: { runId: 'r1', sessionKey: KEY, ...payload } });
  };
  return { gateway, emit, calls };
}

const sent = (calls) => calls.filter((c) => c.method === 'chat.send');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('steer sends chat.send with queueMode steer and the run continues in the same message', async () => {
  const fake = fakeGateway();
  const agent = new OpenClawAgent(fake.gateway, { decorateOutgoing: (text) => `[ctx] ${text}` });
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hello' });
  const run = agent.runAgent();
  await settle();
  fake.emit({ seq: 1, state: 'delta', deltaText: 'Working', message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }] } });
  await settle();
  assert.equal(agent.isRunning, true);

  await agent.steer({ id: 'u2', text: '[ui-event] {"component":"TaskList","event":"toggle"}' });
  const [first, second] = sent(fake.calls);
  assert.deepEqual(first.params, { sessionKey: KEY, message: '[ctx] hello', idempotencyKey: 'u1' });
  assert.deepEqual(second.params, {
    sessionKey: KEY,
    message: '[ctx] [ui-event] {"component":"TaskList","event":"toggle"}',
    idempotencyKey: 'u2',
    queueMode: 'steer',
  });
  // The steering message is visible in the list (typed text, not the decorated one).
  assert.equal(agent.messages.at(-1).role, 'user');
  assert.equal(agent.messages.at(-1).content, '[ui-event] {"component":"TaskList","event":"toggle"}');

  fake.emit({ seq: 2, state: 'delta', deltaText: ' on it', message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it' }] } });
  fake.emit({ seq: 3, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it' }] } });
  await run;
  const assistant = agent.messages.filter((m) => m.role === 'assistant');
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].content, 'Working on it');
  assert.equal(sent(fake.calls).length, 2);
});

test('steer without an active run rejects and sends nothing', async () => {
  const fake = fakeGateway();
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  await assert.rejects(agent.steer({ id: 'u1', text: 'hi' }), /No active run/);
  assert.equal(fake.calls.length, 0);
  assert.equal(agent.messages.length, 0);
});

test('steer after the run finished rejects', async () => {
  const fake = fakeGateway();
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hello' });
  const run = agent.runAgent();
  await settle();
  fake.emit({ seq: 1, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
  await run;
  await assert.rejects(agent.steer({ id: 'u2', text: 'late' }), /No active run/);
  assert.equal(sent(fake.calls).length, 1);
});
