// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/demo/demoScript.test.ts
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { OpenClawAgent } from '../../openclaw/OpenClawAgent.ts';
import { BUILTIN_DEFINITIONS } from '../builtins/definitions.ts';
import { CODE_BUILTINS } from '../builtins/codeMeta.ts';
import { formatUiEvent } from '../catalog.ts';
import { createFenceTransformer } from '../fenceTransformer.ts';
import { decodeFence, parseSegments } from '../fences.ts';
import { ComponentRegistry } from '../registry.ts';
import { DEFINE_TOOL_NAME, isFallbackArgs } from '../types.ts';
import { createDemoGateway } from './demoGateway.ts';
import { DEMO_BROKEN_COMPONENT, DEMO_SCRIPT, chunkReply } from './demoScript.ts';

const BUILTIN_NAMES = ['Card', 'Stack', 'Heading', 'Text', 'Badge', 'Stat', 'StatRow', 'Progress', 'TaskList', 'Suggestions', 'MoneyGlance', 'LineChart', 'BarChart', 'Collapsible'];
const KEY = 'demo:test';

function newRegistry() {
  return new ComponentRegistry({ builtins: BUILTIN_DEFINITIONS, codeBuiltins: CODE_BUILTINS });
}

/** Every ano fence of the script, in order, with its turn index. */
function allFences() {
  const out = [];
  DEMO_SCRIPT.turns.forEach((turn, turnIndex) => {
    for (const seg of parseSegments(turn.reply, { final: true, keepFailed: true })) {
      if (seg.kind !== 'text') out.push({ turnIndex, seg });
    }
  });
  return out;
}

test('every turn starts with the persona prefix and has a distinct user message', () => {
  const users = new Set();
  for (const turn of DEMO_SCRIPT.turns) {
    assert.ok(turn.reply.startsWith('**Ano** '), turn.user);
    assert.ok(turn.user.trim().length > 0);
    users.add(turn.user);
  }
  assert.equal(users.size, DEMO_SCRIPT.turns.length);
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(DEMO_SCRIPT)), 'no em or en dashes');
});

test('every fence is closed and decodes to a tool call', () => {
  const fences = allFences();
  assert.ok(fences.length >= 18, `${fences.length} fences`);
  for (const { turnIndex, seg } of fences) {
    assert.equal(seg.complete, true, `turn ${turnIndex} fence closed`);
    assert.equal(seg.error, undefined);
    const decoded = decodeFence(seg);
    assert.equal(decoded.ok, true, `turn ${turnIndex}: ${decoded.ok ? '' : decoded.error}`);
  }
});

test('every fence validates against the registry except the deliberately broken one', () => {
  const registry = newRegistry();
  const failures = [];
  for (const { turnIndex, seg } of allFences()) {
    if (seg.kind === 'define') {
      const defined = registry.define(JSON.parse(seg.json));
      assert.equal(defined.ok, true, defined.ok ? '' : defined.error);
      continue;
    }
    const decoded = decodeFence(seg, (name, props) => registry.validateProps(name, props));
    if (!decoded.ok) failures.push({ turnIndex, json: seg.json, error: decoded.error });
  }
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.equal(JSON.parse(failures[0].json).component, DEMO_BROKEN_COMPONENT);
  assert.equal(failures[0].turnIndex, DEMO_SCRIPT.turns.length - 1);
});

test('the user component is unknown until its ano-define is applied', () => {
  const registry = newRegistry();
  assert.equal(registry.get('GroceryBudgetBars'), undefined);
  const fences = allFences();
  const define = fences.find((f) => f.seg.kind === 'define');
  assert.ok(define);
  const use = fences.find((f) => f.seg.kind === 'ui' && JSON.parse(f.seg.json).component === 'GroceryBudgetBars');
  assert.ok(use);
  assert.ok(define.turnIndex < use.turnIndex, 'the define comes in an earlier reply than its use');
});

test('all 14 built-ins appear, with figures labelled as sample', () => {
  const names = new Set();
  const sampled = new Set();
  /** Instances are {component, props}; Card and Stack nest more of them in props.children. */
  const visit = (instance) => {
    names.add(instance.component);
    if (instance.props.sample === true) sampled.add(instance.component);
    for (const child of instance.props.children ?? []) visit(child);
  };
  for (const { seg } of allFences()) if (seg.kind === 'ui') visit(JSON.parse(seg.json));
  for (const name of BUILTIN_NAMES) assert.ok(names.has(name), `${name} is shown`);
  for (const name of ['MoneyGlance', 'LineChart', 'BarChart', 'GroceryBudgetBars']) assert.ok(sampled.has(name), `${name} sets sample`);
  assert.ok(DEMO_SCRIPT.turns.some((t) => t.reply.includes('Sample data')));
  const lineChart = allFences().map((f) => f.seg).find((s) => s.kind === 'ui' && JSON.parse(s.json).component === 'LineChart');
  assert.deepEqual(Object.keys(JSON.parse(lineChart.json).props.ranges), ['1M', '3M', '1Y']);
});

test('the chunker reassembles every reply exactly and splits inside fences', () => {
  for (const turn of DEMO_SCRIPT.turns) {
    const chunks = chunkReply(turn.reply);
    assert.equal(chunks.join(''), turn.reply);
    assert.ok(chunks.length > 10);
    assert.ok(chunks.every((c) => c.length > 0));
  }
  assert.equal(chunkReply('').length, 0);
  assert.deepEqual(chunkReply('abcdefg', [3]), ['abc', 'def', 'g']);
  assert.equal(chunkReply('a\ud83d\ude00b', [2]).join(''), 'a\ud83d\ude00b');
  assert.ok(chunkReply('a\ud83d\ude00b', [2]).every((c) => !/[\ud800-\udbff]$/.test(c)));
  assert.throws(() => chunkReply('x', [0]));
});

// ---- gateway ------------------------------------------------------------------------------------

const FAST = { chunkDelayMs: 0, startDelayMs: 0 };

/** Records every chat payload; `when(predicate)` resolves on the first recorded payload matching it. */
function collect(gateway) {
  const frames = [];
  const waiters = [];
  gateway.onEvent((frame) => {
    frames.push(frame.payload);
    for (const waiter of waiters.splice(0)) {
      if (waiter.predicate(frame.payload)) waiter.resolve(frame.payload);
      else waiters.push(waiter);
    }
  });
  const when = (predicate) => {
    const { promise, resolve } = Promise.withResolvers();
    waiters.push({ predicate, resolve });
    return promise;
  };
  return { frames, when };
}

const isFinal = (frame) => frame.state === 'final';

test('chat.history is empty and the connection is ready', async () => {
  const gateway = createDemoGateway(DEMO_SCRIPT, FAST);
  assert.deepEqual((await gateway.request('chat.history', { sessionKey: KEY })).messages, []);
  assert.deepEqual(gateway.getInfo(), { status: 'ready', readyCount: 1 });
});

test('chat.send acks with a runId, then status, deltas and final events', async () => {
  const gateway = createDemoGateway(DEMO_SCRIPT, FAST);
  const { frames, when } = collect(gateway);
  const done = when(isFinal);
  const ack = await gateway.request('chat.send', { sessionKey: KEY, message: DEMO_SCRIPT.turns[0].user, idempotencyKey: 'u1' });
  assert.equal(typeof ack.runId, 'string');
  await done;
  assert.equal(frames[0].state, 'status');
  assert.ok(frames.every((f) => f.runId === ack.runId && f.sessionKey === KEY));
  const deltas = frames.filter((f) => f.state === 'delta');
  assert.ok(deltas.length > 10);
  assert.equal(deltas[0].message.content[0].text, deltas[0].deltaText);
  assert.equal(deltas.map((f) => f.deltaText).join(''), DEMO_SCRIPT.turns[0].reply);
  assert.equal(frames.at(-1).message.content[0].text, DEMO_SCRIPT.turns[0].reply);
  assert.deepEqual(frames.map((f) => f.seq), frames.map((_, i) => i + 1));
  assert.equal(gateway.played, 1);
});

test('chat.abort ends the run without a final event', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gateway = createDemoGateway(DEMO_SCRIPT, { chunkDelayMs: 40, startDelayMs: 120 });
  const { frames } = collect(gateway);
  const ack = await gateway.request('chat.send', { sessionKey: KEY, message: DEMO_SCRIPT.turns[0].user });
  assert.deepEqual(frames.map((f) => f.state), ['status']);
  t.mock.timers.tick(120);
  for (let i = 0; i < 3; i++) t.mock.timers.tick(40);
  assert.deepEqual(frames.map((f) => f.state), ['status', 'delta', 'delta', 'delta', 'delta']);
  const result = await gateway.request('chat.abort', { sessionKey: KEY, runId: ack.runId });
  assert.equal(result.runId, ack.runId);
  assert.equal(frames.at(-1).state, 'aborted');
  const count = frames.length;
  for (let i = 0; i < 5; i++) t.mock.timers.tick(40);
  assert.equal(frames.length, count, 'nothing after the abort');
});

test('a [ui-event] gets a short acknowledgement and does not consume a turn', async () => {
  const gateway = createDemoGateway(DEMO_SCRIPT, FAST);
  const { frames, when } = collect(gateway);
  const done = when(isFinal);
  const message = `<ano-ui-context>\nbrief\n</ano-ui-context>\n\n${formatUiEvent({ component: 'GroceryBudgetBars', event: 'review', payload: { area: 'groceries' } })}`;
  await gateway.request('chat.send', { sessionKey: KEY, message });
  await done;
  const text = frames.at(-1).message.content[0].text;
  assert.ok(text.startsWith('**Ano** '));
  assert.ok(text.includes('review') && text.includes('GroceryBudgetBars'));
  assert.equal(gateway.played, 0);
});

test('a message matching a turn plays that turn, others play the next one, then the fallback; reset starts over', async () => {
  const gateway = createDemoGateway(DEMO_SCRIPT, FAST);
  const { when } = collect(gateway);
  const play = async (message) => {
    const done = when(isFinal);
    await gateway.request('chat.send', { sessionKey: KEY, message });
    const final = await done;
    return final.message.content[0].text;
  };
  assert.equal(await play(DEMO_SCRIPT.turns[1].user), DEMO_SCRIPT.turns[1].reply);
  assert.equal(await play('something unscripted'), DEMO_SCRIPT.turns[0].reply);
  for (const turn of DEMO_SCRIPT.turns.slice(2)) assert.equal(await play(turn.user), turn.reply);
  assert.equal(gateway.played, DEMO_SCRIPT.turns.length);
  assert.equal(await play('and more'), DEMO_SCRIPT.fallbackReply);
  gateway.reset();
  assert.equal(gateway.played, 0);
  assert.equal(await play(DEMO_SCRIPT.turns[0].user), DEMO_SCRIPT.turns[0].reply);
});

// ---- the real agent against the demo gateway ------------------------------------------------------

test('a real OpenClawAgent with the fence transformer turns the replies into the expected tool calls', async () => {
  const registry = newRegistry();
  const gateway = createDemoGateway(DEMO_SCRIPT, FAST);
  const agent = new OpenClawAgent(gateway, {
    createTransformer: (ctx) => createFenceTransformer(ctx, { validate: (name, props) => registry.validateProps(name, props) }),
  });
  agent.threadId = KEY;

  const toolNames = [];
  for (const [i, turn] of DEMO_SCRIPT.turns.entries()) {
    agent.addMessage({ id: `u${i}`, role: 'user', content: turn.user });
    await agent.runAgent();
    const last = agent.messages.at(-1);
    assert.equal(last.role, 'assistant', turn.user);
    toolNames.push((last.toolCalls ?? []).map((tc) => tc.function.name));
    // The define fence registers the component, as the define_component frontend tool does in the app.
    for (const tc of last.toolCalls ?? []) {
      if (tc.function.name === DEFINE_TOOL_NAME) assert.equal(registry.define(JSON.parse(tc.function.arguments)).ok, true);
    }
  }

  assert.deepEqual(toolNames, [
    ['render_MoneyGlance', 'render_StatRow', 'render_Card', 'render_Suggestions'],
    ['render_LineChart', 'render_Stack', 'render_Text', 'render_Suggestions'],
    ['render_Heading', 'render_BarChart', 'render_Card', 'render_Suggestions'],
    ['render_TaskList', 'render_Badge', 'render_Suggestions'],
    ['render_Collapsible', 'render_TaskList', 'render_Suggestions'],
    [DEFINE_TOOL_NAME, 'render_Suggestions'],
    ['render_GroceryBudgetBars', 'render_Progress'],
  ]);

  const last = agent.messages.at(-1);
  const broken = last.toolCalls.at(-1);
  assert.equal(isFallbackArgs(JSON.parse(broken.function.arguments)), true, 'the broken fence settles as fallback args');
  const good = last.toolCalls[0];
  assert.equal(isFallbackArgs(JSON.parse(good.function.arguments)), false);
  assert.ok(last.content.startsWith('**Ano** '));
  assert.ok(!last.content.includes('```'), 'fences are not left in the prose');
});

test('a ui-event through the agent gets the scripted acknowledgement as a plain message', async () => {
  const gateway = createDemoGateway(DEMO_SCRIPT, FAST);
  const agent = new OpenClawAgent(gateway);
  agent.threadId = KEY;
  agent.addMessage({ id: 'e1', role: 'user', content: formatUiEvent({ component: 'TaskList', event: 'toggle', payload: { id: 'bill-electric', value: true } }) });
  await agent.runAgent();
  const last = agent.messages.at(-1);
  assert.equal(last.role, 'assistant');
  assert.ok(last.content.includes('toggle') && last.content.includes('TaskList'));
  assert.equal(gateway.played, 0);
});
