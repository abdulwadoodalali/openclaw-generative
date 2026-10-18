// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/historyIngest.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_DEFINITIONS } from './builtins/definitions.ts';
import { CODE_BUILTINS } from './builtins/codeMeta.ts';
import { DefinitionIngestor, assistantTextsOf, definitionsInText, rebuildDefinitions } from './historyIngest.ts';
import { ComponentRegistry } from './registry.ts';

function bar(name, version = 1, extra = {}) {
  return {
    name,
    version,
    description: `${name} description`,
    props: { type: 'object', required: ['spent'], properties: { spent: { type: 'number' } } },
    root: 'n1',
    nodes: { n1: { t: 'Card', children: ['n2'] }, n2: { t: 'Text', text: '{{spent}}' } },
    ...extra,
  };
}

const fence = (definition) => ['```ano-define', JSON.stringify(definition), '```'].join('\n');

function makeRegistry() {
  return new ComponentRegistry({ builtins: BUILTIN_DEFINITIONS, codeBuiltins: CODE_BUILTINS });
}

function messageWithCalls(id, calls) {
  return {
    id,
    role: 'assistant',
    content: 'text',
    toolCalls: calls.map(([callId, name, args]) => ({ id: callId, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })),
  };
}

test('ingestMessages defines define_component calls in message order and ignores everything else', () => {
  const registry = makeRegistry();
  const ingestor = new DefinitionIngestor(registry);
  ingestor.ingestMessages([
    { id: 'u1', role: 'user', content: 'hi' },
    messageWithCalls('a1', [
      ['a1:tc0', 'render_MoneyGlance', { month: 'October', spent: 1, series: [1, 2] }],
      ['a1:tc1', 'define_component', bar('BudgetBar')],
    ]),
    messageWithCalls('a2', [['a2:tc0', 'define_component', bar('BudgetBar', 2)]]),
  ]);
  assert.equal(registry.get('BudgetBar').version, 2);
  assert.equal(registry.list().filter((entry) => !entry.builtin).length, 1);
});

test('ingesting the same messages again is idempotent, even for replace:true', () => {
  const registry = makeRegistry();
  const ingestor = new DefinitionIngestor(registry);
  const messages = [messageWithCalls('a1', [['a1:tc0', 'define_component', bar('Forced', 1, { replace: true })]])];
  ingestor.ingestMessages(messages);
  const version = registry.catalogVersion;
  ingestor.ingestMessages(messages);
  ingestor.ingestMessages(messages);
  assert.equal(registry.catalogVersion, version);
});

test('streaming (empty or partial) arguments are left for a later pass', () => {
  const registry = makeRegistry();
  const ingestor = new DefinitionIngestor(registry);
  const full = JSON.stringify(bar('Late'));
  ingestor.ingestMessages([messageWithCalls('a1', [['a1:tc0', 'define_component', '']])]);
  ingestor.ingestMessages([messageWithCalls('a1', [['a1:tc0', 'define_component', full.slice(0, 40)]])]);
  assert.equal(registry.get('Late'), undefined);
  ingestor.ingestMessages([messageWithCalls('a1', [['a1:tc0', 'define_component', full]])]);
  assert.ok(registry.get('Late'));
});

test('fallback args are never defined and report why', () => {
  const registry = makeRegistry();
  const ingestor = new DefinitionIngestor(registry);
  const args = { __fallback: '{broken', __error: 'invalid JSON' };
  const outcome = ingestor.define(args);
  assert.deepEqual(outcome, { ok: false, error: 'invalid JSON', summary: 'Skipped: invalid JSON' });
  assert.equal(registry.catalogVersion, 0);
});

test('outcomes: defined, already had, rejected', () => {
  const registry = makeRegistry();
  const ingestor = new DefinitionIngestor(registry);
  assert.equal(ingestor.define(bar('BudgetBar')).summary, 'Defined BudgetBar v1');
  const registry2 = makeRegistry();
  registry2.define(bar('BudgetBar'));
  assert.equal(new DefinitionIngestor(registry2).define(bar('BudgetBar')).summary, 'Already had BudgetBar v1');
  const rejected = ingestor.define(bar('Card'));
  assert.equal(rejected.ok, false);
  assert.ok(rejected.summary.startsWith('Rejected: '));
  assert.equal(ingestor.outcomeFor(bar('Card')), rejected);
  assert.equal(ingestor.outcomeFor(bar('Nope')), undefined);
});

test('subscribers hear about every new outcome once', () => {
  const ingestor = new DefinitionIngestor(makeRegistry());
  let heard = 0;
  const off = ingestor.subscribe(() => {
    heard += 1;
  });
  ingestor.define(bar('A'));
  ingestor.define(bar('A'));
  assert.equal(heard, 1);
  off();
  ingestor.define(bar('B'));
  assert.equal(heard, 1);
});

test('definitionsInText finds complete ano-define fences only', () => {
  const text = ['Here you go.', fence(bar('One')), 'and', '```ano-ui', '{"component":"Stat","props":{}}', '```', fence(bar('Two')), '```ano-define', '{"name":"Cut'].join('\n');
  assert.deepEqual(
    definitionsInText(text).map((d) => d.name),
    ['One', 'Two'],
  );
});

test('assistantTextsOf reads assistant rows of a chat.history result', () => {
  const history = {
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: 'two' },
      { role: 'assistant', content: [] },
    ],
  };
  assert.deepEqual(assistantTextsOf(history), ['one', 'two']);
  assert.deepEqual(assistantTextsOf(null), []);
  assert.deepEqual(assistantTextsOf({ messages: 'x' }), []);
});

function historyOf(...texts) {
  return { messages: texts.map((text) => ({ role: 'assistant', content: [{ type: 'text', text }] })) };
}

test('rebuild walks the newest threads oldest first, sequentially, and a later version wins', async () => {
  const registry = makeRegistry();
  const ingestor = new DefinitionIngestor(registry);
  const histories = {
    new: historyOf(fence(bar('BudgetBar', 2))),
    old: historyOf(fence(bar('BudgetBar', 1)), fence(bar('Other'))),
    broken: null,
  };
  const order = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const scanned = await rebuildDefinitions({
    threads: [{ key: 'new' }, { key: 'broken' }, { key: 'old' }],
    fetchHistory: async (key) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(key);
      await Promise.resolve();
      inFlight -= 1;
      if (histories[key] === null) throw new Error('gone');
      return histories[key];
    },
    ingestor,
  });
  assert.deepEqual(order, ['old', 'broken', 'new']);
  assert.equal(maxInFlight, 1);
  assert.equal(scanned, 2);
  assert.equal(registry.get('BudgetBar').version, 2);
  assert.ok(registry.get('Other'));
});

test('rebuild is capped at the newest 30 threads', async () => {
  const ingestor = new DefinitionIngestor(makeRegistry());
  const threads = Array.from({ length: 45 }, (_, i) => ({ key: `t${i}` }));
  const fetched = [];
  await rebuildDefinitions({
    threads,
    fetchHistory: async (key) => {
      fetched.push(key);
      return historyOf('plain');
    },
    ingestor,
  });
  assert.equal(fetched.length, 30);
  assert.ok(fetched.includes('t0'));
  assert.ok(!fetched.includes('t30'));
});
