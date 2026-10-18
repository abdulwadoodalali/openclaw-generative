// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/fenceTransformer.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventType, defaultApplyEvents, verifyEvents } from '@ag-ui/client';
import { from, lastValueFrom, tap } from 'rxjs';
import { OpenClawAgent } from '../openclaw/OpenClawAgent.ts';
import { createFenceTransformer } from './fenceTransformer.ts';
import { MAX_FENCE_BYTES } from './fences.ts';
import { splitMarkers, stripMarkers, toolCallMarker } from './proseMarkers.ts';
import { CANVAS_TOOL_NAME } from './types.ts';

// ---- fixtures (the canned fences of scripts/mock-gateway.mjs) ---------------------------------

const MONEY_GLANCE_FENCE = [
  '```ano-ui',
  JSON.stringify({
    component: 'MoneyGlance',
    props: {
      month: 'October',
      spent: 2190,
      left: 410,
      cash: 8940,
      sample: true,
      series: [12, 18, 24, 30, 37, 45, 52, 61, 70, 78, 88, 97],
    },
  }),
  '```',
].join('\n');

const SUGGESTIONS_FENCE = [
  '```ano-ui',
  JSON.stringify({ component: 'Suggestions', props: { options: ['By category', 'Pin as canvas'] } }),
  '```',
].join('\n');

const DEFINE_FENCE = [
  '```ano-define',
  JSON.stringify({
    name: 'BudgetBar',
    version: 1,
    description: 'one category vs its budget',
    props: {
      type: 'object',
      required: ['label', 'spent', 'budget'],
      properties: {
        label: { type: 'string' },
        spent: { type: 'number' },
        budget: { type: 'number' },
      },
    },
    root: 'n1',
    nodes: {
      n1: { t: 'Card', children: ['n2'] },
      n2: { t: 'Progress', value: '{{spent}}', max: '{{budget}}' },
    },
  }),
  '```',
].join('\n');

const PROSE_1 = '**Ano** Here is your October snapshot, with sample numbers for offline testing.';
const PROSE_2 = 'Spending is **slightly ahead** of plan, mostly in groceries.';
const PROSE_3 = 'Use it with a `BudgetBar` fence whenever you want a category bar.';

const FIXTURE = [PROSE_1, '', MONEY_GLANCE_FENCE, '', PROSE_2, '', SUGGESTIONS_FENCE, '', DEFINE_FENCE, '', PROSE_3].join('\n');
const M = toolCallMarker;
const FIXTURE_PROSE = [PROSE_1, M(0), PROSE_2, M(1), M(2), PROSE_3].join('\n\n');

const CTX = { messageId: 'm1', runId: 'r1', sessionKey: 'agent:main:dashboard:t1' };

// ---- harness: real AG-UI verification + reducer ---------------------------------------------

const INPUT = { threadId: 't', runId: 'r', messages: [], state: {}, tools: [], context: [], forwardedProps: {} };
const AGENT = { agentId: 'test', messages: [], state: {} };

/** Run events through @ag-ui/client's verifier and default reducer; returns the resulting messages. */
async function applyEvents(events) {
  const all = [
    { type: EventType.RUN_STARTED, threadId: 't', runId: 'r' },
    ...events,
    { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r' },
  ];
  let messages = [];
  await lastValueFrom(
    defaultApplyEvents(INPUT, from(all).pipe(verifyEvents()), AGENT, []).pipe(
      tap((mutation) => {
        if (mutation.messages) messages = mutation.messages;
      }),
    ),
    { defaultValue: undefined },
  );
  return messages;
}

/** Push growing prefixes of `text` cut at `cuts` (ascending), then finish with the full text. */
function streamEvents(text, cuts, opts) {
  const tr = createFenceTransformer(CTX, opts);
  const events = [];
  for (const cut of cuts) events.push(...tr.push(text.slice(0, cut)));
  events.push(...tr.finish(text));
  return events;
}

const view = (m) => ({ content: m.content, toolCalls: m.toolCalls });

/** THE invariant: streamed events apply to exactly toMessage(text). */
async function assertConverges(text, cuts, opts, label = '') {
  const expected = createFenceTransformer(CTX, opts).toMessage(text);
  const messages = await applyEvents(streamEvents(text, cuts, opts));
  assert.equal(messages.length, 1, `${label} one assistant message`);
  assert.equal(messages[0].id, CTX.messageId);
  assert.deepEqual(view(messages[0]), view(expected), label);
}

function seededRandom(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function randomCuts(length, rand, maxStep) {
  const cuts = [];
  let pos = 0;
  while (true) {
    pos += 1 + Math.floor(rand() * maxStep);
    if (pos >= length) return cuts;
    cuts.push(pos);
  }
}

const toolNames = (message) => (message.toolCalls ?? []).map((c) => c.function.name);
const toolArgs = (message, i) => JSON.parse(message.toolCalls[i].function.arguments);

// ---- (a) the chunking invariant ---------------------------------------------------------------

test('toMessage of the mock fixture: prose + three tool calls', () => {
  const m = createFenceTransformer(CTX).toMessage(FIXTURE);
  assert.equal(m.content, FIXTURE_PROSE);
  assert.deepEqual(toolNames(m), ['render_MoneyGlance', 'render_Suggestions', 'define_component']);
  assert.deepEqual(
    m.toolCalls.map((c) => c.id),
    ['m1:tc0', 'm1:tc1', 'm1:tc2'],
  );
  assert.ok(m.toolCalls.every((c) => c.type === 'function'));
  assert.equal(toolArgs(m, 0).series.length, 12);
  assert.deepEqual(toolArgs(m, 1), { options: ['By category', 'Pin as canvas'] });
  assert.equal(toolArgs(m, 2).name, 'BudgetBar');
});

test('toMessage omits toolCalls when there are none', () => {
  const m = createFenceTransformer(CTX).toMessage('**Ano** just text');
  assert.deepEqual(m, { id: 'm1', role: 'assistant', content: '**Ano** just text' });
});

test('invariant: every two-way split of the fixture', async () => {
  for (let i = 1; i < FIXTURE.length; i++) {
    await assertConverges(FIXTURE, [i], undefined, `split at ${i}`);
  }
});

test('invariant: char by char and random chunkings of the fixture', async () => {
  await assertConverges(
    FIXTURE,
    Array.from({ length: FIXTURE.length - 1 }, (_, i) => i + 1),
    undefined,
    'char by char',
  );
  const rand = seededRandom(42);
  for (let round = 0; round < 60; round++) {
    await assertConverges(FIXTURE, randomCuts(FIXTURE.length, rand, 40), undefined, `random round ${round}`);
  }
  await assertConverges(FIXTURE, [], undefined, 'single finish');
});

const EDGE_TEXTS = {
  'bad json, named': 'Before\n\n```ano-ui\n{"component":"Foo", oops}\n```\n\nAfter',
  'bad json, unnamed (degrades to text)': 'Before\n\n```ano-ui\n{not json}\n```\n\nAfter',
  'unclosed at finish, named': 'Before\n\n```ano-ui\n{"component":"MoneyGlance","props":{"spent":',
  'unclosed at finish, unnamed': 'Before\n\n```ano-ui\n{"props":{"spent":1',
  'define without a name': 'Before\n\n```ano-define\n{"version":1}\n```\n',
  'define unclosed': 'Before\n\n```ano-define\n{"name":"X","ver',
  'fence first, no prose, no trailing newline': '```ano-ui\n{"component":"Suggestions","props":{"options":["a"]}}\n```',
  'component name changes after the start': '```ano-ui\n{"component":"A","component":"B"}\n```\nDone',
  'valid with props before component (not announced early)': '```ano-ui\n{"props":{"x":1},"component":"Stat"}\n```\nDone',
  'ano fence inside a ts block': 'Example:\n\n```ts\n```ano-ui\n{"component":"A"}\n```\nAfter',
  'partial opener tail at the end': 'Hello there\n```ano-',
  'bare closing backticks at the end': 'Hello there\n```',
  'two failing unnamed fences between text': 'A\n```ano-ui\n{x}\n```\nB\n```ano-ui\n{y}\n```\nC',
  'back to back fences': `${SUGGESTIONS_FENCE}\n${SUGGESTIONS_FENCE}\n${DEFINE_FENCE}`,
  'CRLF text': 'A\r\n```ano-ui\r\n{"component":"A"}\r\n```\r\nB',
  'empty props and non-object envelope': '```ano-ui\n{"component":"A"}\n```\n```ano-ui\n[1]\n```\n```ano-ui\n{"component":"B","props":[1]}\n```',
};

test('invariant: edge cases, every split and char by char', async () => {
  for (const [label, text] of Object.entries(EDGE_TEXTS)) {
    for (let i = 1; i < text.length; i++) await assertConverges(text, [i], undefined, `${label} split at ${i}`);
    await assertConverges(text, Array.from({ length: text.length - 1 }, (_, i) => i + 1), undefined, `${label} char by char`);
  }
});

test('invariant holds with a validator that rewrites, rejects and ignores components', async () => {
  const validate = (component, props) => {
    if (component === 'MoneyGlance') return { ok: true, props: { ...props, validated: true } };
    if (component === 'Suggestions') return { ok: false, error: 'options must be at most 1' };
    return null;
  };
  for (let i = 1; i < FIXTURE.length; i++) await assertConverges(FIXTURE, [i], { validate }, `split at ${i}`);
  const m = createFenceTransformer(CTX, { validate }).toMessage(FIXTURE);
  assert.equal(toolArgs(m, 0).validated, true);
  assert.deepEqual(toolArgs(m, 1), {
    __fallback: JSON.stringify({ component: 'Suggestions', props: { options: ['By category', 'Pin as canvas'] } }),
    __error: 'options must be at most 1',
  });
  assert.equal(toolArgs(m, 2).name, 'BudgetBar'); // define fences are not run through validate
});

// ---- (b) failures become FallbackArgs ---------------------------------------------------------

test('bad JSON in a named fence: tool call with FallbackArgs', () => {
  const m = createFenceTransformer(CTX).toMessage('Before\n\n```ano-ui\n{"component":"Foo", oops}\n```\n\nAfter');
  assert.equal(m.content, `Before\n\n${M(0)}\n\nAfter`);
  assert.deepEqual(toolNames(m), ['render_Foo']);
  assert.deepEqual(toolArgs(m, 0), { __fallback: '{"component":"Foo", oops}', __error: 'invalid JSON' });
});

test('bad JSON in a fence whose name never showed up stays plain text', () => {
  const m = createFenceTransformer(CTX).toMessage('Before\n\n```ano-ui\n{not json}\n```\n\nAfter');
  assert.equal(m.content, 'Before\n\n```ano-ui\n{not json}\n```\n\nAfter');
  assert.equal(m.toolCalls, undefined);
});

test('oversize fence: FallbackArgs for a named fence, text for an unnamed one', async () => {
  const big = 'x'.repeat(MAX_FENCE_BYTES + 10);
  const named = `Before\n\n\`\`\`ano-ui\n{"component":"Big","props":{"s":"${big}"}}\n\`\`\`\nAfter`;
  const m = createFenceTransformer(CTX).toMessage(named);
  assert.equal(m.content, `Before\n\n${M(0)}\n\nAfter`);
  assert.deepEqual(toolNames(m), ['render_Big']);
  const args = toolArgs(m, 0);
  assert.match(args.__error, /larger than 32768 bytes/);
  assert.equal(args.__fallback.length, MAX_FENCE_BYTES);
  const rand = seededRandom(5);
  for (let round = 0; round < 6; round++) await assertConverges(named, randomCuts(named.length, rand, 9000), undefined, `named ${round}`);

  const unnamed = `Before\n\n\`\`\`ano-ui\n{"props":{"s":"${big}"},"component":"Big"}\n\`\`\`\nAfter`;
  const t = createFenceTransformer(CTX).toMessage(unnamed);
  assert.equal(t.toolCalls, undefined);
  assert.ok(t.content.startsWith('Before\n\n```ano-ui\n{"props"'));
  assert.ok(t.content.endsWith('```\n\nAfter'));
  for (let round = 0; round < 6; round++) await assertConverges(unnamed, randomCuts(unnamed.length, rand, 9000), undefined, `unnamed ${round}`);
});

test('a fence still open at finish: tool call settled with FallbackArgs, never dangling', async () => {
  const text = 'Before\n\n```ano-ui\n{"component":"MoneyGlance","props":{"spent":';
  const events = streamEvents(text, [10, 30, 45]);
  const types = events.map((e) => e.type);
  assert.equal(types.filter((t) => t === EventType.TOOL_CALL_START).length, 1);
  assert.equal(types.filter((t) => t === EventType.TOOL_CALL_END).length, 1);
  const [message] = await applyEvents(events);
  assert.equal(message.content, `Before\n\n${M(0)}`);
  assert.deepEqual(toolArgs(message, 0), {
    __fallback: '{"component":"MoneyGlance","props":{"spent":',
    __error: 'fence was not closed',
  });
});

test('validate failure -> FallbackArgs with the validator error; null = unknown component passes through', () => {
  const text = '```ano-ui\n{"component":"Known","props":{"a":1}}\n```\n```ano-ui\n{"component":"Unknown","props":{"b":2}}\n```';
  const validate = (component) => (component === 'Known' ? { ok: false, error: 'a must be a string' } : null);
  const m = createFenceTransformer(CTX, { validate }).toMessage(text);
  assert.deepEqual(toolNames(m), ['render_Known', 'render_Unknown']);
  assert.deepEqual(toolArgs(m, 0), { __fallback: '{"component":"Known","props":{"a":1}}', __error: 'a must be a string' });
  assert.deepEqual(toolArgs(m, 1), { b: 2 });
});

test('a crashing validator is a validation failure, not an exception', () => {
  const validate = () => {
    throw new Error('boom');
  };
  const m = createFenceTransformer(CTX, { validate }).toMessage('```ano-ui\n{"component":"A"}\n```');
  assert.deepEqual(toolArgs(m, 0), { __fallback: '{"component":"A"}', __error: 'props validation failed' });
});

test('define fence without a string name and a name that changes after the start', () => {
  const noName = createFenceTransformer(CTX).toMessage('```ano-define\n{"version":1}\n```');
  assert.deepEqual(toolNames(noName), ['define_component']);
  assert.equal(toolArgs(noName, 0).__fallback, '{"version":1}');
  const renamed = createFenceTransformer(CTX).toMessage('```ano-ui\n{"component":"A","component":"B"}\n```');
  assert.deepEqual(toolNames(renamed), ['render_A']);
  assert.match(toolArgs(renamed, 0).__error, /component name changed/);
});

// ---- skeleton and event shapes ----------------------------------------------------------------

test('skeleton: TOOL_CALL_START as soon as the component name is complete, args only at the close', () => {
  const tr = createFenceTransformer(CTX);
  const head = '**Ano** Look\n\n```ano-ui\n{"component":"MoneyGl';
  const first = tr.push(head);
  assert.deepEqual(first, [
    { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: '**Ano** Look' },
  ]);
  const named = head + 'ance",';
  assert.deepEqual(tr.push(named), [
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: `\n\n${M(0)}` },
    { type: EventType.TOOL_CALL_START, toolCallId: 'm1:tc0', toolCallName: 'render_MoneyGlance', parentMessageId: 'm1' },
  ]);
  const body = named + '"props":{"spent":5}}\n```\n';
  assert.deepEqual(tr.push(named + '"props":{"spent":'), []);
  assert.deepEqual(tr.push(body), [
    { type: EventType.TOOL_CALL_ARGS, toolCallId: 'm1:tc0', delta: '{"spent":5}' },
    { type: EventType.TOOL_CALL_END, toolCallId: 'm1:tc0' },
  ]);
  assert.deepEqual(tr.push(body + '\nNice.'), [
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: '\n\nNice.' },
  ]);
  assert.deepEqual(tr.finish(body + '\nNice.'), [{ type: EventType.TEXT_MESSAGE_END, messageId: 'm1' }]);
  assert.deepEqual(tr.push('anything'), []);
  assert.deepEqual(tr.finish('anything'), []);
});

test('skeleton: ano-define starts on the completed opener line; fence text is never prose', () => {
  const tr = createFenceTransformer(CTX);
  assert.deepEqual(
    tr.push('Hi\n```ano-define').map((e) => e.type),
    [EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT],
  );
  const events = tr.push('Hi\n```ano-define\n');
  assert.deepEqual(events, [
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: `\n\n${M(0)}` },
    { type: EventType.TOOL_CALL_START, toolCallId: 'm1:tc0', toolCallName: 'define_component', parentMessageId: 'm1' },
  ]);
  for (const e of tr.push('Hi\n```ano-define\n{"name":"X"')) assert.notEqual(e.type, EventType.TEXT_MESSAGE_CONTENT);
});

test('a fence at the very start opens the text message first, so the message content is just its marker', async () => {
  const tr = createFenceTransformer(CTX);
  const events = tr.push('```ano-ui\n{"component":"Suggestions"');
  assert.deepEqual(
    events.map((e) => e.type),
    [EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TOOL_CALL_START],
  );
  const [message] = await applyEvents(streamEvents('```ano-ui\n{"component":"Suggestions"}\n```\n', [12, 30]));
  assert.equal(message.content, M(0));
  assert.deepEqual(toolNames(message), ['render_Suggestions']);
});

test('partial fence openers are held back from the prose', () => {
  const tr = createFenceTransformer(CTX);
  const events = tr.push('Hello\n\n``');
  assert.deepEqual(events[1], { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Hello' });
  assert.deepEqual(tr.push('Hello\n\n```ano-'), []);
  assert.deepEqual(tr.push('Hello\n\n```ts'), [
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: '\n\n```ts' },
  ]);
});

test('text without fences: START, CONTENT deltas, END on ctx.messageId', () => {
  const tr = createFenceTransformer(CTX);
  assert.deepEqual(tr.push('**Ano** Hel').map((e) => e.type), [EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT]);
  assert.deepEqual(tr.push('**Ano** Hello'), [{ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'lo' }]);
  assert.deepEqual(tr.finish('**Ano** Hello'), [{ type: EventType.TEXT_MESSAGE_END, messageId: 'm1' }]);
  assert.deepEqual(createFenceTransformer(CTX).finish(''), []);
});

// ---- rebase -------------------------------------------------------------------------------

test('rebase emits nothing and treats the calls in the new text as emitted', () => {
  const tr = createFenceTransformer(CTX);
  tr.push('draft');
  tr.rebase(FIXTURE);
  assert.deepEqual(tr.push(FIXTURE), []);
  assert.deepEqual(tr.finish(FIXTURE), [{ type: EventType.TEXT_MESSAGE_END, messageId: 'm1' }]);
});

test('rebase snapshot mid-stream keeps open fences as skeletons; the stream carries on and converges', async () => {
  const before = 'first draft\n\n```ano-ui\n{"component":"Old","props":{';
  const rewritten = FIXTURE;
  // END of a dropped call makes the reducer log "No message found"; that is expected here.
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    for (let i = 1; i <= rewritten.length; i++) {
      const tr = createFenceTransformer(CTX);
      const events = [];
      // the old text streamed far enough for an Old call to be open in the event stream
      events.push(...tr.push(before));
      const cut = rewritten.slice(0, i);
      tr.rebase(cut);
      events.push({ type: EventType.MESSAGES_SNAPSHOT, messages: [tr.toMessage(cut)] });
      for (let j = i + 1; j < rewritten.length; j += 37) events.push(...tr.push(rewritten.slice(0, j)));
      events.push(...tr.finish(rewritten));
      const [message] = await applyEvents(events);
      assert.deepEqual(view(message), view(createFenceTransformer(CTX).toMessage(rewritten)), `rewrite cut at ${i}`);
    }
  } finally {
    console.warn = warn;
  }
});

// ---- (c) end to end through the real OpenClawAgent --------------------------------------------

function fakeGateway(handlers) {
  const listeners = new Set();
  const statusListeners = new Set();
  const calls = [];
  const info = { status: 'ready', readyCount: 1 };
  const gateway = {
    async request(method, params = {}) {
      calls.push({ method, params });
      const h = handlers[method];
      if (!h) throw new Error(`unhandled ${method}`);
      return await h(params);
    },
    onEvent(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeStatus(l) {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    getInfo: () => info,
  };
  const emit = (payload) => {
    for (const l of [...listeners]) l({ type: 'event', event: 'chat', payload });
  };
  return { gateway, emit, calls, info, statusListeners };
}

const KEY = 'agent:main:dashboard:t1';
const textRow = (text, extra = {}) => ({ role: 'assistant', content: [{ type: 'text', text }], ...extra });

function chunked(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function assertFixtureMessage(message, idPrefix) {
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, FIXTURE_PROSE);
  assert.deepEqual(toolNames(message), ['render_MoneyGlance', 'render_Suggestions', 'define_component']);
  assert.deepEqual(
    message.toolCalls.map((c) => c.id),
    [0, 1, 2].map((n) => `${idPrefix}:tc${n}`),
  );
  assert.equal(toolArgs(message, 0).month, 'October');
  assert.deepEqual(toolArgs(message, 1), { options: ['By category', 'Pin as canvas'] });
  assert.equal(toolArgs(message, 2).name, 'BudgetBar');
}

test('real OpenClawAgent run: deltas with fences become one assistant message with content + toolCalls', async () => {
  const pieces = chunked(FIXTURE, 23);
  const fake = fakeGateway({
    'chat.send': () => {
      setTimeout(() => {
        let acc = '';
        pieces.forEach((piece, i) => {
          acc += piece;
          fake.emit({
            runId: 'r1',
            sessionKey: KEY,
            seq: i + 1,
            state: 'delta',
            deltaText: piece,
            ...(i === 0 ? { message: textRow(acc) } : {}),
          });
        });
        fake.emit({ runId: 'r1', sessionKey: KEY, seq: pieces.length + 1, state: 'final', message: textRow(FIXTURE) });
      }, 5);
      return { runId: 'r1', status: 'started' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway, { createTransformer: (ctx) => createFenceTransformer(ctx) });
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'show my budget' });
  await agent.runAgent();
  assert.equal(agent.messages.length, 2);
  const last = agent.messages[agent.messages.length - 1];
  assertFixtureMessage(last, last.id);
});

test('real OpenClawAgent run: a rewrite mid-stream resnapshots and still ends with the right message', async () => {
  const fake = fakeGateway({
    'chat.send': () => {
      setTimeout(() => {
        fake.emit({ runId: 'r2', sessionKey: KEY, seq: 1, state: 'delta', deltaText: 'draft\n\n```ano-ui\n{"component":"Old"', message: textRow('draft\n\n```ano-ui\n{"component":"Old"') });
        fake.emit({ runId: 'r2', sessionKey: KEY, seq: 2, state: 'delta', deltaText: FIXTURE.slice(0, 200), replace: true });
        fake.emit({ runId: 'r2', sessionKey: KEY, seq: 3, state: 'delta', deltaText: FIXTURE.slice(200) });
        fake.emit({ runId: 'r2', sessionKey: KEY, seq: 4, state: 'final', message: textRow(FIXTURE) });
      }, 5);
      return { runId: 'r2' };
    },
  });
  const agent = new OpenClawAgent(fake.gateway, { createTransformer: (ctx) => createFenceTransformer(ctx) });
  agent.threadId = KEY;
  agent.addMessage({ id: 'u1', role: 'user', content: 'show my budget' });
  await agent.runAgent();
  const last = agent.messages[agent.messages.length - 1];
  assertFixtureMessage(last, last.id);
  assert.equal(agent.messages.length, 2);
});

test('real OpenClawAgent connect: chat.history rows produce the same toolCalls through MESSAGES_SNAPSHOT', async () => {
  const fake = fakeGateway({
    'chat.history': () => ({
      messages: [
        { role: 'user', content: 'show my budget', __openclaw: { id: 'u-a' } },
        textRow(FIXTURE, { __openclaw: { id: 'b' } }),
      ],
    }),
  });
  const agent = new OpenClawAgent(fake.gateway, { createTransformer: (ctx) => createFenceTransformer(ctx) });
  await agent.openThread(KEY);
  assert.equal(agent.messages.length, 2);
  assertFixtureMessage(agent.messages[1], 'b');
});

test('real OpenClawAgent connect: an in-flight run with an open fence is adopted and finished', async () => {
  const inFlightText = FIXTURE.slice(0, FIXTURE.indexOf('"Suggestions"') + 4);
  const fake = fakeGateway({
    'chat.history': () => {
      setTimeout(() => {
        fake.emit({
          runId: 'live',
          sessionKey: KEY,
          seq: 9,
          state: 'delta',
          deltaText: FIXTURE.slice(inFlightText.length),
          message: textRow(FIXTURE),
        });
        fake.emit({ runId: 'live', sessionKey: KEY, seq: 10, state: 'final', message: textRow(FIXTURE) });
      }, 10);
      return { messages: [{ role: 'user', content: 'go' }], inFlightRun: { runId: 'live', text: inFlightText } };
    },
  });
  const agent = new OpenClawAgent(fake.gateway, { createTransformer: (ctx) => createFenceTransformer(ctx) });
  await agent.openThread(KEY);
  assert.equal(agent.messages.length, 2);
  const last = agent.messages[1];
  assertFixtureMessage(last, last.id);
});

// ---- markers keep prose and cards in order ----------------------------------------------------

const ORDERED = ['intro', MONEY_GLANCE_FENCE, 'middle', SUGGESTIONS_FENCE, 'outro'].join('\n\n');

test('prose, card, prose, card keep their order through toMessage', () => {
  const m = createFenceTransformer(CTX).toMessage(ORDERED);
  assert.deepEqual(splitMarkers(m.content), [
    { type: 'text', text: 'intro' },
    { type: 'call', index: 0 },
    { type: 'text', text: 'middle' },
    { type: 'call', index: 1 },
    { type: 'text', text: 'outro' },
  ]);
  assert.deepEqual(toolNames(m), ['render_MoneyGlance', 'render_Suggestions']);
  assert.equal(stripMarkers(m.content), 'intro\n\nmiddle\n\noutro');
});

test('ordering survives every chunking and a history reload (same text, same message)', async () => {
  await assertConverges(ORDERED, Array.from({ length: ORDERED.length - 1 }, (_, i) => i + 1), undefined, 'char by char');
  const rand = seededRandom(11);
  for (let round = 0; round < 8; round++) await assertConverges(ORDERED, randomCuts(ORDERED.length, rand, 40), undefined, `random ${round}`);
  const live = await applyEvents(streamEvents(ORDERED, [7, 20, 90, 300]));
  const reloaded = createFenceTransformer(CTX).toMessage(ORDERED);
  assert.deepEqual(view(live[0]), view(reloaded));
});

test('a streaming card is marked in place before its args arrive', () => {
  const tr = createFenceTransformer(CTX);
  const text = 'intro\n\n```ano-ui\n{"component":"MoneyGlance","props":{"spent":';
  tr.rebase(text); // a mid-stream snapshot keeps open fences as skeletons
  const m = tr.toMessage(text);
  assert.deepEqual(splitMarkers(m.content), [{ type: 'text', text: 'intro' }, { type: 'call', index: 0 }]);
  assert.equal(m.toolCalls[0].function.arguments, '');
});

test('stripMarkers and splitMarkers ignore text without markers and odd markers', () => {
  assert.equal(stripMarkers('plain text'), 'plain text');
  assert.deepEqual(splitMarkers('plain'), [{ type: 'text', text: 'plain' }]);
  assert.deepEqual(splitMarkers('<!--other-->'), [{ type: 'text', text: '<!--other-->' }]);
});

// ---- ano-canvas fences ------------------------------------------------------------------------

const CANVAS_BODY = { op: 'create', title: 'Groceries', blocks: [{ component: 'TaskList', props: { tasks: [{ id: 'a', title: 'Milk' }] } }] };
const CANVAS_FENCE = ['```ano-canvas', JSON.stringify(CANVAS_BODY), '```'].join('\n');

test('ano-canvas fence becomes a canvas_update tool call with the parsed object', async () => {
  const text = `Saved.\n\n${CANVAS_FENCE}\n\nAnything else?`;
  const m = createFenceTransformer(CTX).toMessage(text);
  assert.deepEqual(toolNames(m), [CANVAS_TOOL_NAME]);
  assert.deepEqual(toolArgs(m, 0), CANVAS_BODY);
  assert.equal(m.content, `Saved.\n\n${M(0)}\n\nAnything else?`);
  await assertConverges(text, Array.from({ length: text.length - 1 }, (_, i) => i + 1), undefined, 'canvas char by char');
});

test('ano-canvas is not validated against the registry, and bad JSON becomes FallbackArgs', () => {
  const validate = () => ({ ok: false, error: 'never called for canvas' });
  const ok = createFenceTransformer(CTX, { validate }).toMessage(CANVAS_FENCE);
  assert.deepEqual(toolArgs(ok, 0), CANVAS_BODY);
  const bad = createFenceTransformer(CTX).toMessage('```ano-canvas\n{"op": oops}\n```');
  assert.deepEqual(toolNames(bad), [CANVAS_TOOL_NAME]);
  assert.deepEqual(toolArgs(bad, 0), { __fallback: '{"op": oops}', __error: 'invalid JSON' });
  const array = createFenceTransformer(CTX).toMessage('```ano-canvas\n[1,2]\n```');
  assert.equal(toolArgs(array, 0).__error, 'canvas update must be a JSON object');
});
