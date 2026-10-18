// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/preamble.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_DEFINITIONS } from './builtins/definitions.ts';
import { CODE_BUILTINS } from './builtins/codeMeta.ts';
import { cleanUserText, formatUiEvent } from './catalog.ts';
import { MAX_SEEN_THREADS, createCatalogTracker } from './preamble.ts';
import { ComponentRegistry } from './registry.ts';

const BUDGET_BAR = {
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

function memoryStorage(initial = null) {
  const storage = {
    data: initial,
    async load() {
      return storage.data;
    },
    async save(json) {
      storage.data = json;
    },
  };
  return storage;
}

function makeRegistry() {
  return new ComponentRegistry({ builtins: BUILTIN_DEFINITIONS, codeBuiltins: CODE_BUILTINS });
}

const KEY = 'agent:main:dashboard:t1';

test('first message gets the brief, the second goes out plain', async () => {
  const registry = makeRegistry();
  const tracker = createCatalogTracker(registry, memoryStorage());
  await tracker.ready;
  const first = tracker.decorateOutgoing('hello', { sessionKey: KEY, firstMessage: true });
  assert.ok(first.startsWith('<ano-ui-context>'));
  assert.ok(first.endsWith('hello'));
  assert.equal(tracker.decorateOutgoing('again', { sessionKey: KEY, firstMessage: false }), 'again');
});

test('a component defined mid-thread reaches the thread as one delta', async () => {
  const registry = makeRegistry();
  const tracker = createCatalogTracker(registry, memoryStorage());
  await tracker.ready;
  tracker.decorateOutgoing('hello', { sessionKey: KEY, firstMessage: true });
  assert.equal(registry.define(BUDGET_BAR).ok, true);
  const next = tracker.decorateOutgoing('more', { sessionKey: KEY, firstMessage: false });
  assert.ok(next.startsWith('[catalog-update]'));
  assert.ok(next.includes('BudgetBar'));
  assert.ok(next.endsWith('more'));
  assert.equal(tracker.decorateOutgoing('and more', { sessionKey: KEY, firstMessage: false }), 'and more');
});

test('a ui-event also carries the pending delta and is still hidden after cleaning', async () => {
  const registry = makeRegistry();
  const tracker = createCatalogTracker(registry, memoryStorage());
  await tracker.ready;
  tracker.decorateOutgoing('hello', { sessionKey: KEY, firstMessage: true });
  registry.define(BUDGET_BAR);
  const event = formatUiEvent({ component: 'BudgetBar', event: 'open', payload: { id: 'g1' } });
  const sent = tracker.decorateOutgoing(event, { sessionKey: KEY, firstMessage: false });
  assert.ok(sent.startsWith('[catalog-update]'));
  assert.deepEqual(cleanUserText(sent), { text: event, hidden: true });
});

test('a thread that never saw the catalog gets the brief even when it is not the first message', async () => {
  const registry = makeRegistry();
  const tracker = createCatalogTracker(registry, memoryStorage());
  await tracker.ready;
  const sent = tracker.decorateOutgoing('old thread', { sessionKey: 'agent:main:dashboard:old', firstMessage: false });
  assert.ok(sent.startsWith('<ano-ui-context>'));
  assert.equal(tracker.seenVersion('agent:main:dashboard:old'), registry.catalogVersion);
});

test('threads are tracked independently', async () => {
  const registry = makeRegistry();
  const tracker = createCatalogTracker(registry, memoryStorage());
  await tracker.ready;
  tracker.decorateOutgoing('a', { sessionKey: 'a', firstMessage: true });
  registry.define(BUDGET_BAR);
  assert.ok(tracker.decorateOutgoing('b', { sessionKey: 'b', firstMessage: true }).startsWith('<ano-ui-context>'));
  assert.ok(tracker.decorateOutgoing('a2', { sessionKey: 'a', firstMessage: false }).startsWith('[catalog-update]'));
});

test('the seen map survives a restart', async () => {
  const storage = memoryStorage();
  const registry = makeRegistry();
  const before = createCatalogTracker(registry, storage);
  await before.ready;
  before.decorateOutgoing('hello', { sessionKey: KEY, firstMessage: true });
  registry.define(BUDGET_BAR);
  before.decorateOutgoing('more', { sessionKey: KEY, firstMessage: false });
  await before.flush();

  const after = createCatalogTracker(registry, storage);
  await after.ready;
  assert.equal(after.seenVersion(KEY), registry.catalogVersion);
  assert.equal(after.decorateOutgoing('third', { sessionKey: KEY, firstMessage: false }), 'third');
});

test('garbage or failing storage starts empty instead of throwing', async () => {
  const registry = makeRegistry();
  const garbage = createCatalogTracker(registry, memoryStorage('{not json'));
  await garbage.ready;
  assert.equal(garbage.seenVersion(KEY), undefined);
  const failing = createCatalogTracker(registry, {
    async load() {
      throw new Error('keychain locked');
    },
    async save() {
      throw new Error('keychain locked');
    },
  });
  await failing.ready;
  assert.ok(failing.decorateOutgoing('hi', { sessionKey: KEY, firstMessage: true }).startsWith('<ano-ui-context>'));
});

test('only the most recent threads are remembered', async () => {
  const storage = memoryStorage();
  const tracker = createCatalogTracker(makeRegistry(), storage);
  await tracker.ready;
  for (let i = 0; i < MAX_SEEN_THREADS + 5; i += 1) tracker.decorateOutgoing('x', { sessionKey: `k${i}`, firstMessage: true });
  assert.equal(tracker.seenVersion('k0'), undefined);
  assert.equal(tracker.seenVersion(`k${MAX_SEEN_THREADS + 4}`), 0);
  await tracker.flush();
  assert.equal(JSON.parse(storage.data).length, MAX_SEEN_THREADS);
});

test('cleanUserText undoes the decoration exactly', async () => {
  const registry = makeRegistry();
  const tracker = createCatalogTracker(registry, memoryStorage());
  await tracker.ready;
  const brief = tracker.decorateOutgoing('what did I spend?', { sessionKey: KEY, firstMessage: true });
  assert.deepEqual(cleanUserText(brief), { text: 'what did I spend?' });
  registry.define(BUDGET_BAR);
  const delta = tracker.decorateOutgoing('and groceries?', { sessionKey: KEY, firstMessage: false });
  assert.deepEqual(cleanUserText(delta), { text: 'and groceries?' });
});
