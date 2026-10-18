// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Structural sanity of the built-in definitions, independent of the registry validator.
// Run: node --experimental-strip-types --test src/genui/builtins/definitions.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTemplate } from '../bindings.ts';
import { COMPONENT_NAME_RE, LIMITS, PRIMITIVES, SPACING, TONES } from '../types.ts';
import { BUILTIN_DEFINITIONS } from './definitions.ts';

const EXPECTED = ['Card', 'Stack', 'Heading', 'Text', 'Badge', 'Stat', 'StatRow', 'Progress', 'TaskList', 'Suggestions'];
const byName = Object.fromEntries(BUILTIN_DEFINITIONS.map((d) => [d.name, d]));

function schemaDepth(schema) {
  let deepest = 0;
  for (const child of [...Object.values(schema.properties ?? {}), ...(schema.items ? [schema.items] : [])]) {
    deepest = Math.max(deepest, 1 + schemaDepth(child));
  }
  return deepest;
}

function stringFields(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringFields(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringFields(v, out));
  return out;
}

function reachable(def) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !def.nodes[id]) return;
    seen.add(id);
    for (const child of def.nodes[id].children ?? []) visit(child);
    if (typeof def.nodes[id].template === 'string') visit(def.nodes[id].template);
  };
  visit(def.root);
  return seen;
}

test('exactly the ten definable built-ins, unique and valid names', () => {
  assert.deepEqual(BUILTIN_DEFINITIONS.map((d) => d.name), EXPECTED);
  for (const def of BUILTIN_DEFINITIONS) {
    assert.match(def.name, COMPONENT_NAME_RE, def.name);
    assert.equal(def.version, 1, def.name);
    assert.ok(def.description.length > 10 && def.description.length < 200, `${def.name} description length`);
  }
});

test('size limits', () => {
  for (const def of BUILTIN_DEFINITIONS) {
    assert.ok(Buffer.byteLength(JSON.stringify(def)) <= LIMITS.maxDefinitionBytes, `${def.name} json bytes`);
    assert.ok(Object.keys(def.nodes).length <= LIMITS.maxNodes, `${def.name} node count`);
    assert.ok((def.actions ?? []).length <= LIMITS.maxActions, `${def.name} action count`);
    assert.equal(def.props.type, 'object', `${def.name} root props type`);
    assert.ok(schemaDepth(def.props) <= LIMITS.maxSchemaDepth, `${def.name} schema depth`);
  }
});

test('root, children and template ids exist; every node is reachable; no child cycles', () => {
  for (const def of BUILTIN_DEFINITIONS) {
    assert.ok(def.nodes[def.root], `${def.name} root`);
    for (const [id, node] of Object.entries(def.nodes)) {
      for (const child of node.children ?? []) assert.ok(def.nodes[child], `${def.name}.${id} child ${child}`);
      if (node.t === 'List') assert.ok(def.nodes[node.template], `${def.name}.${id} template`);
    }
    assert.deepEqual([...reachable(def)].sort(), Object.keys(def.nodes).sort(), `${def.name} unreachable nodes`);
    const visiting = new Set();
    const walk = (id, depth) => {
      assert.ok(depth <= LIMITS.maxDepth, `${def.name} depth`);
      assert.ok(!visiting.has(id), `${def.name} cycle at ${id}`);
      visiting.add(id);
      for (const child of def.nodes[id].children ?? []) walk(child, depth + 1);
      if (def.nodes[id].t === 'List') walk(def.nodes[id].template, depth + 1);
      visiting.delete(id);
    };
    walk(def.root, 1);
  }
});

test('node types are primitives (built-ins never compose each other)', () => {
  for (const def of BUILTIN_DEFINITIONS) {
    for (const [id, node] of Object.entries(def.nodes)) {
      assert.ok(PRIMITIVES.includes(node.t), `${def.name}.${id} t=${node.t}`);
    }
  }
});

test('actions: nodes reference declared actions only, and every declared action is used', () => {
  for (const def of BUILTIN_DEFINITIONS) {
    const declared = new Set(def.actions ?? []);
    const used = new Set();
    for (const [id, node] of Object.entries(def.nodes)) {
      if (node.action === undefined) continue;
      assert.ok(declared.has(node.action.name), `${def.name}.${id} undeclared action ${node.action.name}`);
      used.add(node.action.name);
    }
    assert.deepEqual([...used].sort(), [...declared].sort(), `${def.name} unused or undeclared actions`);
  }
  assert.deepEqual(byName.TaskList.actions, ['toggle']);
  assert.deepEqual(byName.Suggestions.actions, ['pick']);
});

test('binding roots are declared props or item/index/state', () => {
  for (const def of BUILTIN_DEFINITIONS) {
    const props = new Set(Object.keys(def.props.properties ?? {}));
    for (const text of stringFields(def.nodes)) {
      for (const match of text.matchAll(/\{\{([^}]*)\}\}/g)) {
        const root = match[1].split('|')[0].trim().split('.')[0];
        assert.ok(props.has(root) || ['item', 'index', 'state'].includes(root), `${def.name} binding ${match[0]}`);
      }
    }
    for (const required of def.props.required ?? []) assert.ok(props.has(required), `${def.name} required ${required}`);
  }
});

test('literal tokens only: gap and spacing values are on the scale, tones are tones', () => {
  for (const def of BUILTIN_DEFINITIONS) {
    for (const [id, node] of Object.entries(def.nodes)) {
      if (typeof node.gap === 'number') assert.ok(SPACING.includes(node.gap), `${def.name}.${id} gap`);
      if (typeof node.tone === 'string' && !node.tone.includes('{{')) assert.ok(TONES.includes(node.tone), `${def.name}.${id} tone`);
    }
    assert.deepEqual(def.props.properties.tone?.enum ?? [...TONES], [...TONES]);
  }
});

test('no em-dashes or emoji in definitions', () => {
  const text = JSON.stringify(BUILTIN_DEFINITIONS);
  assert.ok(!text.includes('\u2014'));
  assert.ok(!/\p{Extended_Pictographic}/u.test(text));
});

test('TaskList bindings resolve for one task', () => {
  const task = { id: 't1', title: 'Pay rent', done: true, due: '2026-10-12' };
  const scope = { props: {}, item: task, index: 0, state: {} };
  const def = byName.TaskList;
  assert.deepEqual(resolveTemplate(def.nodes.check.action, scope), { name: 'toggle', payload: { id: 't1' } });
  assert.equal(resolveTemplate(def.nodes.check.checked, scope), true);
  assert.equal(resolveTemplate(def.nodes.check.label, scope), 'Pay rent');
  assert.equal(resolveTemplate(def.nodes.due.text, scope), 'Oct 12');
});

test('Suggestions pick payload resolves to the chip text', () => {
  const scope = { props: {}, item: 'By category', index: 1, state: {} };
  const chip = byName.Suggestions.nodes.chip;
  assert.equal(resolveTemplate(chip.label, scope), 'By category');
  assert.deepEqual(resolveTemplate(chip.action, scope), { name: 'pick', payload: { text: 'By category' } });
});

test('Progress binds numbers with their type', () => {
  const scope = { props: { label: 'Groceries', value: 482.5, max: 600 }, state: {} };
  const nodes = byName.Progress.nodes;
  assert.equal(resolveTemplate(nodes.bar.value, scope), 482.5);
  assert.equal(resolveTemplate(nodes.bar.max, scope), 600);
  assert.equal(resolveTemplate(nodes.amounts.text, scope), '482.5 / 600');
});
