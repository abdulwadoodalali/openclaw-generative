// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/registry.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentRegistry } from './registry.ts';

const CARD = {
  name: 'Card',
  version: 1,
  description: 'A card holding other components.',
  props: { type: 'object', properties: { title: { type: 'string' } } },
  root: 'root',
  nodes: { root: { t: 'Card', title: '{{title}}' } },
};
const STAT = {
  name: 'Stat',
  version: 1,
  description: 'One figure with a label.',
  props: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string' } } },
  root: 'root',
  nodes: { root: { t: 'Stat', label: '{{label}}', value: '{{value}}' } },
};
const GLANCE = {
  name: 'MoneyGlance',
  description: 'Month snapshot.',
  props: { type: 'object', required: ['spent'], properties: { spent: { type: 'number' } } },
};

function memoryStorage(initial = null) {
  const storage = {
    data: initial,
    saves: 0,
    failing: false,
    async load() {
      return storage.data;
    },
    async save(json) {
      storage.saves += 1;
      if (storage.failing) throw new Error('disk full');
      storage.data = json;
    },
  };
  return storage;
}

function makeRegistry(storage) {
  return new ComponentRegistry({ builtins: [CARD, STAT], codeBuiltins: [GLANCE], storage });
}

function userDef(name, version = 1, extra = {}) {
  return {
    name,
    version,
    description: `the ${name} component`,
    props: { type: 'object', required: ['label'], properties: { label: { type: 'string' } } },
    root: 'n1',
    nodes: { n1: { t: 'Text', text: `{{label}} v${version}` } },
    ...extra,
  };
}

test('built-ins load first, protected, at catalogVersion 0', () => {
  const registry = makeRegistry();
  assert.deepEqual(registry.list().map((e) => e.name), ['Card', 'Stat', 'MoneyGlance']);
  assert.ok(registry.list().every((e) => e.builtin && e.changedAt === 0));
  assert.equal(registry.get('MoneyGlance').definition, undefined);
  assert.equal(registry.get('Card').definition.name, 'Card');
  assert.equal(registry.catalogVersion, 0);
  assert.equal(registry.hasUserDefinitions, false);
});

test('malformed or duplicate built-ins throw', () => {
  const bad = { ...CARD, name: 'Broken', root: 'nope' };
  assert.throws(() => new ComponentRegistry({ builtins: [bad], codeBuiltins: [] }), /Broken/);
  assert.throws(() => new ComponentRegistry({ builtins: [CARD, CARD], codeBuiltins: [] }), /Duplicate/);
});

test('define registers a user component and bumps catalogVersion', () => {
  const registry = makeRegistry();
  const result = registry.define(userDef('BudgetBar'));
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.entry.builtin, false);
  assert.equal(result.entry.changedAt, 1);
  assert.equal(registry.catalogVersion, 1);
  assert.equal(registry.get('BudgetBar').version, 1);
  assert.equal(registry.hasUserDefinitions, true);
  assert.equal(registry.define(userDef('Second')).entry.changedAt, 2);
});

test('built-ins and primitive names cannot be redefined', () => {
  const registry = makeRegistry();
  for (const name of ['Card', 'Stat', 'MoneyGlance', 'Grid']) {
    const result = registry.define(userDef(name, 9));
    assert.equal(result.ok, false, name);
    assert.match(result.error, new RegExp(`${name}V2`));
  }
  assert.equal(registry.catalogVersion, 0);
  assert.equal(registry.get('Card').version, 1);
});

test('invalid definitions are reported and change nothing', () => {
  const registry = makeRegistry();
  const result = registry.define({ ...userDef('Bad'), root: 'missing' });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(registry.define('nope').ok, false);
  assert.equal(registry.catalogVersion, 0);
  assert.equal(registry.get('Bad'), undefined);
});

test('higher version replaces; same or lower is ignored; replace:true forces', () => {
  const registry = makeRegistry();
  registry.define(userDef('Bar', 2));

  const lower = registry.define(userDef('Bar', 1));
  assert.deepEqual([lower.ok, lower.changed], [true, false]);
  const same = registry.define(userDef('Bar', 2, { description: 'changed text' }));
  assert.equal(same.changed, false);
  assert.equal(registry.get('Bar').description, 'the Bar component');
  assert.equal(registry.catalogVersion, 1);

  const higher = registry.define(userDef('Bar', 3));
  assert.equal(higher.changed, true);
  assert.equal(registry.get('Bar').version, 3);
  assert.equal(registry.catalogVersion, 2);
  assert.equal(registry.get('Bar').changedAt, 2);

  const forced = registry.define(userDef('Bar', 1, { replace: true }));
  assert.equal(forced.changed, true);
  assert.equal(registry.get('Bar').version, 1);
  assert.equal(registry.catalogVersion, 3);
});

test('changedAt follows the catalogVersion of the last change only for that component', () => {
  const registry = makeRegistry();
  registry.define(userDef('A'));
  registry.define(userDef('B'));
  registry.define(userDef('A', 2));
  assert.equal(registry.get('A').changedAt, 3);
  assert.equal(registry.get('B').changedAt, 2);
});

test('composition resolves through the registry and rejects cycles', () => {
  const registry = makeRegistry();
  assert.equal(registry.define(userDef('Outer', 1, { nodes: { n1: { t: 'Inner', label: 'x' } } })).ok, false);
  registry.define(userDef('Inner'));
  assert.equal(registry.define(userDef('Outer', 1, { nodes: { n1: { t: 'Inner', label: 'x' } } })).ok, true);
  const cycle = registry.define(userDef('Inner', 2, { nodes: { n1: { t: 'Outer' } } }));
  assert.equal(cycle.ok, false);
  assert.match(cycle.error, /each other/);
});

test('revert restores exactly one previous version', () => {
  const registry = makeRegistry();
  assert.equal(registry.revert('Nope'), false);
  registry.define(userDef('Bar', 1));
  assert.equal(registry.revert('Bar'), false);
  registry.define(userDef('Bar', 2));
  registry.define(userDef('Bar', 3));
  const before = registry.catalogVersion;

  assert.equal(registry.revert('Bar'), true);
  assert.equal(registry.get('Bar').version, 2);
  assert.equal(registry.catalogVersion, before + 1);
  assert.equal(registry.get('Bar').changedAt, before + 1);
  assert.equal(registry.revert('Bar'), false);
  assert.equal(registry.revert('Card'), false);
});

test('validateProps: unknown null, ok, errors, coercion, code built-ins', () => {
  const registry = makeRegistry();
  assert.equal(registry.validateProps('Nope', {}), null);
  assert.deepEqual(registry.validateProps('Stat', { label: 'Cash', value: 2190 }), { ok: true, props: { label: 'Cash', value: '2190' } });
  const missing = registry.validateProps('Stat', { label: 'Cash' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /value/);
  assert.equal(registry.validateProps('MoneyGlance', { spent: 5 }).ok, true);
  assert.equal(registry.validateProps('MoneyGlance', { spent: 'x' }).ok, false);
  registry.define(userDef('Bar'));
  assert.equal(registry.validateProps('Bar', { label: 'a' }).ok, true);
  registry.define(userDef('Bar', 2, { props: { type: 'object', required: ['other'], properties: { other: { type: 'number' } } } }));
  assert.equal(registry.validateProps('Bar', { label: 'a' }).ok, false, 'new version uses its own schema');
  assert.equal(registry.validateProps('Bar', { other: 1 }).ok, true);
});

test('subscribe notifies on changes only and can unsubscribe', () => {
  const registry = makeRegistry();
  let calls = 0;
  const off = registry.subscribe(() => {
    calls += 1;
  });
  registry.define(userDef('Bar', 1));
  assert.equal(calls, 1);
  registry.define(userDef('Bar', 1));
  registry.define('junk');
  assert.equal(calls, 1);
  registry.define(userDef('Bar', 2));
  registry.revert('Bar');
  assert.equal(calls, 3);
  off();
  registry.define(userDef('Bar', 5));
  assert.equal(calls, 3);
});

test('persistence round trip keeps versions, changedAt and the revert slot', async () => {
  const storage = memoryStorage();
  const first = makeRegistry(storage);
  first.define(userDef('Bar', 1));
  first.define(userDef('Bar', 2));
  first.define(userDef('Other', 1));
  await first.flush();
  const saved = JSON.parse(storage.data);
  assert.equal(saved.catalogVersion, 3);
  assert.equal(saved.entries.length, 2);
  assert.equal(saved.previous.length, 1);

  const second = makeRegistry(storage);
  assert.equal(second.hasUserDefinitions, false);
  let notified = 0;
  second.subscribe(() => {
    notified += 1;
  });
  await second.load();
  assert.equal(notified, 1);
  assert.equal(second.hasUserDefinitions, true);
  assert.equal(second.catalogVersion, 3);
  assert.equal(second.get('Bar').version, 2);
  assert.equal(second.get('Bar').changedAt, 2);
  assert.equal(second.get('Other').changedAt, 3);
  assert.equal(second.get('Bar').builtin, false);
  assert.equal(second.revert('Bar'), true);
  assert.equal(second.get('Bar').version, 1);
  assert.equal(second.define(userDef('Bar', 2)).changed, true);
});

test('load tolerates garbage and a missing file', async () => {
  for (const data of [null, '', 'not json', '[]', '{"catalogVersion":"x"}', '{"catalogVersion":1}', '{"catalogVersion":-1,"entries":[]}']) {
    const registry = makeRegistry(memoryStorage(data));
    await registry.load();
    assert.equal(registry.hasUserDefinitions, false, String(data));
    assert.equal(registry.catalogVersion, 0, String(data));
  }
  const throwing = { load: async () => { throw new Error('io'); }, save: async () => {} };
  const registry = makeRegistry(throwing);
  await registry.load();
  assert.equal(registry.list().length, 3);
  await makeRegistry().load();
});

test('load drops invalid stored entries, ignores built-in names and resolves composition in any order', async () => {
  const outer = userDef('Outer', 1, { nodes: { n1: { t: 'Inner', label: 'x' } } });
  const stored = {
    catalogVersion: 7,
    entries: [
      { definition: outer, changedAt: 6 },
      { definition: userDef('Inner'), changedAt: 5 },
      { definition: { ...userDef('Broken'), root: 'gone' }, changedAt: 4 },
      { definition: userDef('Card', 9), changedAt: 3 },
      { definition: 42, changedAt: 2 },
    ],
    previous: [{ definition: userDef('Inner', 0 + 1), changedAt: 1 }],
  };
  const registry = makeRegistry(memoryStorage(JSON.stringify(stored)));
  await registry.load();
  assert.deepEqual(registry.list().filter((e) => !e.builtin).map((e) => e.name).sort(), ['Inner', 'Outer']);
  assert.equal(registry.get('Card').version, 1);
  assert.equal(registry.get('Outer').changedAt, 6);
  assert.equal(registry.catalogVersion, 7);
});

test('save failures are swallowed and later saves still run', async () => {
  const storage = memoryStorage();
  storage.failing = true;
  const registry = makeRegistry(storage);
  assert.equal(registry.define(userDef('Bar')).ok, true);
  await registry.flush();
  assert.equal(storage.saves, 1);
  storage.failing = false;
  registry.define(userDef('Bar', 2));
  await registry.flush();
  assert.equal(JSON.parse(storage.data).entries[0].definition.version, 2);
});

test('saves are ordered: a slow first save cannot be overtaken', async () => {
  const written = [];
  const firstSaveGate = Promise.withResolvers();
  const storage = {
    load: async () => null,
    async save(json) {
      if (written.length === 0) await firstSaveGate.promise;
      written.push(JSON.parse(json).catalogVersion);
    },
  };
  const registry = makeRegistry(storage);
  registry.define(userDef('A'));
  registry.define(userDef('B'));
  registry.define(userDef('C'));
  firstSaveGate.resolve();
  await registry.flush();
  assert.deepEqual(written, [1, 2, 3]);
});
