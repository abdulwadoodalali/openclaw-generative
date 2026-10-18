// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Node tests for the OpenClaw to AG-UI adapter, run against an in-memory fake gateway.
// Run: node --experimental-strip-types --test src/openclaw/OpenClawAgent.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawAgent, type GatewayLike } from './OpenClawAgent.ts';

type Listener = (event: { type: 'event'; event: string; payload?: unknown }) => void;

function fakeGateway(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const listeners = new Set<Listener>();
  const statusListeners = new Set<() => void>();
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const info = { status: 'ready', readyCount: 1 };
  const gateway: GatewayLike = {
    async request(method, params = {}) {
      calls.push({ method, params });
      const h = handlers[method];
      if (!h) throw new Error(`unhandled ${method}`);
      return (await h(params)) as never;
    },
    onEvent(l) {
      listeners.add(l as Listener);
      return () => listeners.delete(l as Listener);
    },
    subscribeStatus(l) {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    getInfo: () => info,
  };
  const emit = (payload: Record<string, unknown>) => {
    for (const l of [...listeners]) l({ type: 'event', event: 'chat', payload });
  };
  const emitAgent = (payload: Record<string, unknown>) => {
    for (const l of [...listeners]) l({ type: 'event', event: 'agent', payload });
  };
  return { gateway, emit, emitAgent, calls, info, statusListeners };
}

const KEY = 'agent:main:dashboard:t1';
const tick = () => new Promise((r) => setTimeout(r, 5));

test('run streams deltas into one assistant message and finishes', async () => {
  const fake = fakeGateway({
    'chat.send': () => {
      setTimeout(async () => {
        fake.emit({ runId: 'r1', sessionKey: KEY, seq: 1, state: 'status', phase: 'starting_model' });
        fake.emit({ runId: 'r1', sessionKey: KEY, seq: 2, state: 'delta', deltaText: '**Ano** Hel', message: { role: 'assistant', content: [{ type: 'text', text: '**Ano** Hel' }] } });
        fake.emit({ runId: 'r1', sessionKey: KEY, seq: 3, state: 'delta', deltaText: 'lo there' });
        fake.emit({ runId: 'r1', sessionKey: KEY, seq: 4, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: '**Ano** Hello there' }] } });
      }, 5);
      return { runId: 'r1', status: 'started' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  await agent.runAgent();
  const last = agent.messages[agent.messages.length - 1];
  assert.equal(last.role, 'assistant');
  assert.equal((last as { content?: string }).content, '**Ano** Hello there');
  assert.equal(agent.messages.length, 2);
  assert.equal(fake.calls[0].method, 'chat.send');
  assert.equal(fake.calls[0].params.sessionKey, KEY);
  assert.equal(fake.calls[0].params.idempotencyKey, 'u1');
  assert.equal(fake.calls[0].params.message, 'hi');
});

test('events arriving before the chat.send ack are not lost', async () => {
  const fake = fakeGateway({
    'chat.send': async () => {
      fake.emit({ runId: 'r2', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'early', message: { role: 'assistant', content: [{ type: 'text', text: 'early' }] } });
      fake.emit({ runId: 'r2', sessionKey: KEY, seq: 2, state: 'final' });
      return { runId: 'r2', status: 'started' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  await agent.runAgent();
  assert.equal((agent.messages[1] as { content?: string }).content, 'early');
});

test('events of other sessions and other runs are ignored', async () => {
  const fake = fakeGateway({
    'chat.send': () => {
      setTimeout(() => {
        fake.emit({ runId: 'x', sessionKey: 'agent:main:other', seq: 1, state: 'delta', deltaText: 'WRONG SESSION' });
        fake.emit({ runId: 'zzz', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'WRONG RUN' });
        fake.emit({ runId: 'r3', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'ok', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
        fake.emit({ runId: 'r3', sessionKey: KEY, seq: 2, state: 'final' });
      }, 5);
      return { runId: 'r3' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  await agent.runAgent();
  assert.equal((agent.messages[1] as { content?: string }).content, 'ok');
});

test('a rewrite (replace) resnapshots instead of appending', async () => {
  const fake = fakeGateway({
    'chat.send': () => {
      setTimeout(() => {
        fake.emit({ runId: 'r4', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'draft one', message: { role: 'assistant', content: [{ type: 'text', text: 'draft one' }] } });
        fake.emit({ runId: 'r4', sessionKey: KEY, seq: 2, state: 'delta', deltaText: 'second take', replace: true });
        fake.emit({ runId: 'r4', sessionKey: KEY, seq: 3, state: 'final' });
      }, 5);
      return { runId: 'r4' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  await agent.runAgent();
  assert.equal(agent.messages.length, 2);
  assert.equal((agent.messages[1] as { content?: string }).content, 'second take');
});

test('a gateway error becomes RUN_ERROR', async () => {
  const fake = fakeGateway({
    'chat.send': () => {
      setTimeout(() => fake.emit({ runId: 'r5', sessionKey: KEY, seq: 1, state: 'error', errorMessage: 'model refused' }), 5);
      return { runId: 'r5' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const errors: string[] = [];
  await agent.runAgent(undefined, { onRunErrorEvent: ({ event }) => void errors.push(event.message) });
  assert.deepEqual(errors, ['model refused']);
  assert.equal(agent.isRunning, false);
});

test('a failed chat.send surfaces as an error', async () => {
  const fake = fakeGateway({
    'chat.send': () => {
      throw new Error('gateway not connected');
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const errors: string[] = [];
  await agent.runAgent(undefined, { onRunErrorEvent: ({ event }) => void errors.push(event.message) });
  assert.deepEqual(errors, ['gateway not connected']);
});

test('abortRun sends chat.abort for the run', async () => {
  const fake = fakeGateway({
    'chat.send': () => ({ runId: 'r6' }),
    'chat.abort': () => ({}),
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const p = agent.runAgent().catch(() => undefined);
  await tick();
  await tick();
  agent.abortRun();
  await p;
  await tick();
  const abort = fake.calls.find((c) => c.method === 'chat.abort');
  assert.ok(abort, 'chat.abort was sent');
  assert.equal(abort?.params.runId, 'r6');
});

test('selectThread detaches without aborting the gateway run', async () => {
  const fake = fakeGateway({
    'chat.send': () => ({ runId: 'r7' }),
    'chat.abort': () => ({}),
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const p = agent.runAgent().catch(() => undefined);
  await tick();
  await tick();
  agent.selectThread('agent:main:dashboard:t2');
  await p;
  await tick();
  assert.equal(fake.calls.some((c) => c.method === 'chat.abort'), false);
  assert.equal(agent.threadId, 'agent:main:dashboard:t2');
  assert.equal(agent.messages.length, 0);
});

test('openThread loads history as a snapshot (string user rows, block assistant rows)', async () => {
  const fake = fakeGateway({
    'chat.history': () => ({
      messages: [
        { role: 'user', content: 'ping', __openclaw: { id: 'a' } },
        { role: 'assistant', content: [{ type: 'text', text: '**Ano** pong' }], __openclaw: { id: 'b' } },
        { role: 'toolResult', content: 'hidden' },
        { role: 'assistant', content: [{ type: 'tool_use' }] },
      ],
    }),
  });
  const agent = new OpenClawAgent(fake.gateway);
  await agent.openThread(KEY);
  assert.equal(agent.messages.length, 2);
  assert.equal(agent.messages[0].role, 'user');
  assert.equal((agent.messages[1] as { content?: string }).content, '**Ano** pong');
  assert.equal(fake.calls[0].params.sessionKey, KEY);
});

test('openThread adopts an in-flight run and streams it to the end', async () => {
  const fake = fakeGateway({
    'chat.history': () => {
      setTimeout(() => {
        fake.emit({ runId: 'live', sessionKey: KEY, seq: 9, state: 'delta', deltaText: ' world', message: { role: 'assistant', content: [{ type: 'text', text: 'hello world' }] } });
        fake.emit({ runId: 'live', sessionKey: KEY, seq: 10, state: 'final' });
      }, 10);
      return { messages: [{ role: 'user', content: 'go' }], inFlightRun: { runId: 'live', text: 'hello' } };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  await agent.openThread(KEY);
  assert.equal(agent.messages.length, 2);
  assert.equal((agent.messages[1] as { content?: string }).content, 'hello world');
});

test('hooks: decorateOutgoing wraps the sent text only, cleanIncoming hides rows', async () => {
  const fake = fakeGateway({
    'chat.send': () => ({ runId: 'r8' }),
    'chat.history': () => ({
      messages: [
        { role: 'user', content: '<pre>hello' },
        { role: 'user', content: '[ui-event] {}' },
      ],
    }),
  });
  const agent = new OpenClawAgent(fake.gateway, {
    decorateOutgoing: (t, ctx) => (ctx.firstMessage ? `<pre>${t}` : t),
    cleanIncoming: (t) => (t.startsWith('[ui-event]') ? { text: t, hidden: true } : { text: t.replace(/^<pre>/, '') }),
  });
  await agent.openThread(KEY);
  assert.deepEqual(agent.messages.map((m) => (m as { content?: string }).content), ['hello']);
  agent.addMessage({ id: 'u2', role: 'user', content: 'second' });
  // run returns once the ack arrives and nothing else does; stop it after checking the call
  const p = agent.runAgent().catch(() => undefined);
  await tick();
  await tick();
  const send = fake.calls.find((c) => c.method === 'chat.send');
  assert.equal(send?.params.message, 'second');
  agent.abortRun();
  await p;
});

test('a follow-up run whose last message is a tool result sends nothing', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'never' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  agent.addMessage({ id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }] });
  agent.addMessage({ id: 'tm1', role: 'tool', toolCallId: 't1', content: 'ok' });
  await agent.runAgent();
  assert.equal(fake.calls.length, 0);
});

test('a model-fallback notice sent as a final does not end the run', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'n1' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const p = agent.runAgent();
  await tick();
  const notice = { type: 'text', text: '↪️ Model Fallback: opencode-go/kimi-k3', openclawStatusNotice: true };
  fake.emit({ runId: 'n1', sessionKey: KEY, seq: 2, state: 'final', message: { role: 'assistant', content: [notice] } });
  await tick();
  assert.equal(agent.isRunning, true);
  fake.emit({ runId: 'n1', sessionKey: KEY, seq: 9, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } });
  await p;
  assert.deepEqual(
    agent.messages.filter((m) => m.role === 'assistant').map((m) => m.content),
    ['Hello'],
  );
});

test('a run that ended while disconnected shows every stored row after the reconnect', async () => {
  const fake = fakeGateway({
    'chat.send': () => ({ runId: 'g1' }),
    'chat.history': () => ({
      messages: [
        { role: 'user', content: 'budget?', __openclaw: { id: 'm1' } },
        { role: 'assistant', content: [{ type: 'text', text: 'Handing this to Ano Finance.' }], __openclaw: { id: 'm2' } },
        { role: 'assistant', content: [{ type: 'text', text: 'You are $410 under budget.' }], __openclaw: { id: 'm3' } },
      ],
    }),
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'budget?' });
  const p = agent.runAgent();
  await tick();
  fake.emit({ runId: 'g1', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'Handing', message: { role: 'assistant', content: [{ type: 'text', text: 'Handing' }] } });
  // The socket dropped and came back; the run finished in between (no final was received).
  fake.info.readyCount = 2;
  for (const l of [...fake.statusListeners]) l();
  await p;
  assert.deepEqual(
    agent.messages.map((m) => [m.role, m.content]),
    [
      ['user', 'budget?'],
      ['assistant', 'Handing this to Ano Finance.'],
      ['assistant', 'You are $410 under budget.'],
    ],
  );
});

test("activity follows thinking, a handoff and the other agent's tools, then the answer", async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'a1' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'budget?' });
  const p = agent.runAgent();
  await tick();
  const own = (stream: string, data: Record<string, unknown>) => fake.emitAgent({ runId: 'a1', sessionKey: KEY, stream, data });
  const seen: Array<Record<string, unknown>> = [];
  // AG-UI applies events asynchronously: let them land before reading agent.state.
  const snap = async () => {
    await tick();
    seen.push({ ...agent.state.activity });
  };

  own('lifecycle', { phase: 'fallback_step', fallbackStepToModel: 'opencode-go/kimi-k3' });
  own('thinking', { delta: 'User asks budget' });
  await snap();
  own('item', { kind: 'preamble', phase: 'update', progressText: 'Ano That is a finance question.' });
  own('tool', { phase: 'start', name: 'sessions_send', args: { agentId: 'finance', message: 'budget' } });
  await snap();
  own('tool', { phase: 'result', name: 'sessions_send', result: { details: { runId: 'child1', sessionKey: 'agent:finance:main' } } });
  // The child run's events carry the other agent's session key.
  fake.emitAgent({ runId: 'child1', sessionKey: 'agent:finance:main', stream: 'item', data: { kind: 'tool', phase: 'start', name: 'finances__budget_status', title: 'Finances Budget Status' } });
  await snap();
  // Another session's run must not leak in.
  fake.emitAgent({ runId: 'zzz', sessionKey: 'agent:x:y', stream: 'item', data: { kind: 'tool', phase: 'start', name: 'exec', title: 'Exec' } });
  fake.emit({ runId: 'a1', sessionKey: KEY, seq: 5, state: 'delta', deltaText: 'Under', message: { role: 'assistant', content: [{ type: 'text', text: 'Under' }] } });
  await snap();
  fake.emit({ runId: 'a1', sessionKey: KEY, seq: 6, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'Under budget' }] } });
  await p;

  assert.deepEqual(seen, [
    { mode: 'thinking', note: null, step: null, model: 'kimi-k3' },
    { mode: 'working', note: 'That is a finance question.', step: 'Asking Finance', model: 'kimi-k3' },
    { mode: 'working', note: 'That is a finance question.', step: 'Finance: Finances Budget Status', model: 'kimi-k3' },
    { mode: 'answering', note: 'That is a finance question.', step: null, model: 'kimi-k3' },
  ]);
});

const finalFrame = (runId: string, text: string, extra: unknown[] = []) => ({
  runId,
  sessionKey: KEY,
  seq: 9,
  state: 'final',
  message: { role: 'assistant', content: [...extra, { type: 'text', text }] },
});

test('attachments queued for a user message reach chat.send once', async () => {
  let runs = 0;
  const fake = fakeGateway({
    'chat.send': () => {
      const runId = `r${(runs += 1)}`;
      setTimeout(() => fake.emit(finalFrame(runId, 'seen')), 5);
      return { runId };
    },
  });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  const attachments = [{ type: 'image', mimeType: 'image/jpeg', fileName: 'a.jpg', content: 'QUJD' }];
  agent.setOutgoingAttachments('u1', attachments);
  agent.addMessage({ id: 'u1', role: 'user', content: 'what is this?' });
  await agent.runAgent();
  assert.deepEqual(fake.calls[0].params.attachments, attachments);
  assert.equal(fake.calls[0].params.message, 'what is this?');
  assert.equal(fake.calls[0].params.idempotencyKey, 'u1');

  // The attachments were consumed: the next message goes out without any.
  agent.addMessage({ id: 'u2', role: 'user', content: 'and now?' });
  await agent.runAgent();
  assert.equal('attachments' in fake.calls[1].params, false);
});

test('live thinking is captured for the assistant message, with how long it took', async () => {
  let now = 10_000;
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'th1' }) });
  const agent = new OpenClawAgent(fake.gateway, {}, { now: () => now });
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'plan my week' });
  const p = agent.runAgent();
  await tick();
  const think = (data: Record<string, unknown>) => fake.emitAgent({ runId: 'th1', sessionKey: KEY, stream: 'thinking', data });
  think({ text: 'The user wants' });
  now += 1500;
  think({ text: 'The user wants a plan', delta: ' a plan' });
  now += 2500; // answer starts 4s after the first thinking event
  fake.emit({ runId: 'th1', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'Mon', message: { role: 'assistant', content: [{ type: 'text', text: 'Mon' }] } });
  now += 9000; // later time must not stretch a finished thought
  fake.emit(finalFrame('th1', 'Mon: gym'));
  await p;

  const answer = agent.messages[agent.messages.length - 1];
  assert.equal(answer.role, 'assistant');
  assert.deepEqual(agent.processFor(answer.id), { thinking: 'The user wants a plan', seconds: 4, steps: [] });
  assert.equal(agent.processFor('u1'), null);
});

test('thinking deltas without a running text are appended', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'th2' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const p = agent.runAgent();
  await tick();
  for (const delta of ['Say ', 'hello']) fake.emitAgent({ runId: 'th2', sessionKey: KEY, stream: 'thinking', data: { delta } });
  fake.emit(finalFrame('th2', 'Hello'));
  await p;
  const answer = agent.messages[agent.messages.length - 1];
  assert.equal(agent.processFor(answer.id).thinking, 'Say hello');
});

test('thinking blocks on the final frame are used when no live thinking arrived', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'th3' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const p = agent.runAgent();
  await tick();
  fake.emit(finalFrame('th3', 'Hello', [{ type: 'thinking', thinking: 'Greet back' }]));
  await p;
  const answer = agent.messages[agent.messages.length - 1];
  assert.deepEqual(agent.processFor(answer.id), { thinking: 'Greet back', seconds: null, steps: [] });
});

test('a run without thinking or steps has no process', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'th4' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
  const p = agent.runAgent();
  await tick();
  fake.emit(finalFrame('th4', 'Hello'));
  await p;
  assert.equal(agent.processFor(agent.messages[agent.messages.length - 1].id), null);
});

test('history rows: thinking and tool calls become the process of the answer that follows them', async () => {
  const fake = fakeGateway({
    'chat.history': () => ({
      messages: [
        { role: 'user', content: 'plan my week', idempotencyKey: 'sent-1', __openclaw: { id: 'srv-1' } },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Check the calendar first' },
            { type: 'toolCall', name: 'finances__budget_status', arguments: {} },
          ],
          __openclaw: { id: 'a1' },
        },
        { role: 'toolResult', content: 'events' },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'exec', arguments: {} }, { type: 'toolCall', name: 'exec', arguments: {} }], __openclaw: { id: 'a1b' } },
        { role: 'assistant', content: [{ type: 'tool_use', name: 'sessions_send', input: { agentId: 'finance' } }], __openclaw: { id: 'a1c' } },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'Then lay out the days' }, { type: 'text', text: 'Mon: gym' }], __openclaw: { id: 'a2' } },
        { role: 'user', content: 'thanks', __openclaw: { id: 'u2' } },
        { role: 'assistant', content: [{ type: 'text', text: 'Anytime' }], __openclaw: { id: 'a3' } },
      ],
    }),
  });
  const agent = new OpenClawAgent(fake.gateway);
  await agent.openThread(KEY);
  assert.deepEqual(agent.messages.map((m) => m.id), ['sent-1', 'a2', 'u2', 'a3']);
  assert.deepEqual(agent.processFor('a2'), {
    thinking: 'Check the calendar first\n\nThen lay out the days',
    seconds: null,
    steps: [{ label: 'Finances Budget Status' }, { label: 'Running a command' }, { label: 'Asking Finance' }],
  });
  assert.equal(agent.processFor('a1'), null);
  // A new user turn starts clean.
  assert.equal(agent.processFor('a3'), null);
});

test('live steps are kept per answer, in order, without consecutive repeats', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'st1' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'budget?' });
  const p = agent.runAgent();
  await tick();
  const own = (stream: string, data: Record<string, unknown>) => fake.emitAgent({ runId: 'st1', sessionKey: KEY, stream, data });
  own('item', { kind: 'tool', phase: 'start', name: 'tool_search', title: 'Tool Search' });
  own('item', { kind: 'tool', phase: 'start', name: 'tool_search', title: 'Tool Search' });
  own('item', { kind: 'tool', phase: 'start', name: 'finances__budget_status', title: 'Finances Budget Status' });
  own('thinking', { text: 'Looking at the numbers' });
  fake.emit({ runId: 'st1', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'Under', message: { role: 'assistant', content: [{ type: 'text', text: 'Under' }] } });
  own('item', { kind: 'tool', phase: 'start', name: 'tool_search', title: 'Tool Search' }); // after the answer began
  fake.emit(finalFrame('st1', 'Under budget'));
  await p;

  const answer = agent.messages[agent.messages.length - 1];
  const process = agent.processFor(answer.id);
  assert.deepEqual(process.steps, [
    { label: 'Looking for the right tool' },
    { label: 'Finances Budget Status' },
    { label: 'Looking for the right tool' },
  ]);
  assert.equal(process.thinking, 'Looking at the numbers');

  // Second turn: its answer has its own steps, not the first run's.
  agent.addMessage({ id: 'u2', role: 'user', content: 'thanks' });
  const p2 = agent.runAgent();
  await tick();
  fake.emit(finalFrame('st1', 'Welcome'));
  await p2.catch(() => undefined);
  assert.equal(agent.processFor(agent.messages[agent.messages.length - 1].id), null);
});

test('steer sends the message and its attachments into the running run', async () => {
  const fake = fakeGateway({ 'chat.send': () => ({ runId: 'sr1' }) });
  const agent = new OpenClawAgent(fake.gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'start' });
  const p = agent.runAgent();
  await tick();
  const attachments = [{ type: 'image', mimeType: 'image/png', fileName: 'x.png', content: 'WFla' }];
  agent.setOutgoingAttachments('u2', attachments);
  await agent.steer({ id: 'u2', text: 'also this' });
  const steer = fake.calls[1].params;
  assert.equal(steer.queueMode, 'steer');
  assert.equal(steer.message, 'also this');
  assert.equal(steer.idempotencyKey, 'u2');
  assert.deepEqual(steer.attachments, attachments);
  assert.equal(agent.messages[agent.messages.length - 1].id, 'u2');
  fake.emit(finalFrame('sr1', 'ok'));
  await p;
});
