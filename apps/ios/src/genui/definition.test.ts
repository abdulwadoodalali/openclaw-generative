// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/definition.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePropSchema, utf8Bytes, validateDefinition } from './definition.ts';

const none = () => undefined;

function definition(overrides = {}) {
  return {
    name: 'BudgetBar',
    version: 1,
    description: 'one category against its budget',
    props: {
      type: 'object',
      required: ['label'],
      properties: { label: { type: 'string' }, spent: { type: 'number' } },
    },
    root: 'n1',
    nodes: {
      n1: { t: 'Card', children: ['n2', 'n3'] },
      n2: { t: 'Text', text: '{{label}}', tone: 'muted' },
      n3: { t: 'Progress', value: '{{spent}}', max: 100 },
    },
    ...overrides,
  };
}

function entryOf(def, builtin = false) {
  return { name: def.name, version: def.version, description: def.description, props: def.props, builtin, definition: def, changedAt: 0 };
}

function invalid(input, resolve = none) {
  const result = validateDefinition(input, resolve);
  assert.equal(result.ok, false, 'expected the definition to be rejected');
  assert.equal(typeof result.error, 'string');
  return result.error;
}

test('accepts a valid definition and strips unknown top-level keys', () => {
  const result = validateDefinition({ ...definition(), junk: 1 }, none);
  assert.equal(result.ok, true);
  assert.equal(result.definition.name, 'BudgetBar');
  assert.equal('junk' in result.definition, false);
});

test('rejects non-object input, bad names and bad versions', () => {
  invalid('nope');
  invalid(null);
  invalid(definition({ name: '1Bad' }));
  invalid(definition({ name: 'has space' }));
  invalid(definition({ name: 'A'.repeat(65) }));
  invalid(definition({ version: 0 }));
  invalid(definition({ version: 1.5 }));
});

test('props root must be an object schema', () => {
  assert.match(invalid(definition({ props: { type: 'string' } })), /object/);
});

test('root and children must exist', () => {
  assert.match(invalid(definition({ root: 'zz' })), /root/);
  const nodes = { n1: { t: 'Stack', children: ['ghost'] } };
  assert.match(invalid(definition({ nodes })), /ghost/);
});

test('a node reachable twice or in a cycle is rejected', () => {
  const twice = { n1: { t: 'Stack', children: ['n2', 'n2'] }, n2: { t: 'Spacer' } };
  assert.match(invalid(definition({ nodes: twice })), /more than once|cycle/);
  const cycle = { n1: { t: 'Stack', children: ['n2'] }, n2: { t: 'Stack', children: ['n1'] } };
  assert.match(invalid(definition({ nodes: cycle })), /more than once|cycle/);
});

test('a List template counts as a child edge', () => {
  const nodes = { n1: { t: 'List', items: '{{xs}}', template: 'missing' } };
  assert.match(invalid(definition({ nodes })), /missing/);
});

test('depth limit: 8 levels pass, 9 fail', () => {
  const chain = (levels) => {
    const nodes = {};
    for (let i = 1; i <= levels; i++) nodes[`n${i}`] = i < levels ? { t: 'Stack', children: [`n${i + 1}`] } : { t: 'Spacer' };
    return nodes;
  };
  assert.equal(validateDefinition(definition({ nodes: chain(8) }), none).ok, true);
  assert.match(invalid(definition({ nodes: chain(9) })), /deeper/);
});

test('node count limit: 200 pass, 201 fail', () => {
  const flat = (count) => {
    const nodes = { n0: { t: 'Stack', children: [] } };
    for (let i = 1; i < count; i++) {
      nodes[`n${i}`] = { t: 'Spacer' };
      nodes.n0.children.push(`n${i}`);
    }
    return nodes;
  };
  assert.equal(validateDefinition(definition({ nodes: flat(200), root: 'n0' }), none).ok, true);
  assert.match(invalid(definition({ nodes: flat(201), root: 'n0' })), /nodes/);
});

test('size limit counts UTF-8 bytes, not characters', () => {
  assert.equal(utf8Bytes('aé€😀'), 1 + 2 + 3 + 4);
  const big = (char, count) => definition({ nodes: { n1: { t: 'Text', text: char.repeat(count) } } });
  assert.equal(validateDefinition(big('a', 15000), none).ok, true);
  assert.match(invalid(big('a', 17000)), /KB/);
  // 9000 two-byte characters are under 16 KB as characters but over it as bytes.
  assert.match(invalid(big('é', 9000)), /KB/);
});

test('actions: at most 8, nodes may only reference declared ones', () => {
  const nine = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
  assert.match(invalid(definition({ actions: nine })), /actions/);
  const button = (name) => ({ n1: { t: 'Button', label: 'Open', action: { name } } });
  assert.equal(validateDefinition(definition({ nodes: button('open'), actions: ['open'] }), none).ok, true);
  assert.match(invalid(definition({ nodes: button('open'), actions: ['close'] })), /not listed/);
  assert.match(invalid(definition({ nodes: button('open') })), /not listed/);
  for (const t of ['Pressable', 'Checkbox', 'Segmented']) {
    const nodes = { n1: { t, action: { name: 'nope' } } };
    assert.match(invalid(definition({ nodes, actions: ['x'] })), /not listed/, t);
  }
  assert.match(invalid(definition({ nodes: { n1: { t: 'Button', action: 'open' } }, actions: ['open'] })), /action/);
});

test('Image uri must be https unless it is a binding', () => {
  const image = (uri) => definition({ nodes: { n1: { t: 'Image', uri } } });
  assert.equal(validateDefinition(image('https://example.com/a.png'), none).ok, true);
  assert.equal(validateDefinition(image('{{photo}}'), none).ok, true);
  assert.match(invalid(image('http://example.com/a.png')), /https/);
  assert.match(invalid(image('file:///etc/passwd')), /https/);
  assert.match(invalid(definition({ nodes: { n1: { t: 'Image' } } })), /uri/);
});

test('literal tones must be design tones; bindings pass', () => {
  const badge = (tone) => definition({ nodes: { n1: { t: 'Badge', text: 'x', tone } } });
  for (const tone of ['default', 'accent', 'household', 'muted', 'danger', '{{tone}}']) {
    assert.equal(validateDefinition(badge(tone), none).ok, true, tone);
  }
  assert.match(invalid(badge('#ff0000')), /tone/);
  assert.match(invalid(badge('red')), /tone/);
});

test('composition: unknown component fails, registered one passes', () => {
  const nodes = { n1: { t: 'Stack', children: ['n2'] }, n2: { t: 'Gauge', value: 1 } };
  assert.match(invalid(definition({ nodes })), /Gauge/);
  const gauge = entryOf(definition({ name: 'Gauge' }));
  const resolve = (name) => (name === 'Gauge' ? gauge : undefined);
  assert.equal(validateDefinition(definition({ nodes }), resolve).ok, true);
});

test('composition: self use and mutual use are rejected', () => {
  const uses = (name, other) => definition({ name, nodes: { n1: { t: other } } });
  assert.match(invalid(uses('Loop', 'Loop')), /itself/);
  const a = entryOf(uses('A', 'B'));
  const b = entryOf(definition({ name: 'B' }));
  const resolve = (name) => ({ A: a, B: b })[name];
  // B is registered without using A; redefining B to use A closes the loop A -> B -> A.
  assert.match(invalid(uses('B', 'A'), resolve), /each other/);
  // Transitive: C -> A -> B, and B redefined to use C.
  const c = entryOf(uses('C', 'A'));
  const resolveAll = (name) => ({ A: a, B: b, C: c })[name];
  assert.match(invalid(uses('B', 'C'), resolveAll), /each other/);
});

test('a node named like a primitive is the primitive, never a registry reference', () => {
  const card = definition({ name: 'Card', nodes: { n1: { t: 'Card', title: '{{label}}' } } });
  assert.equal(validateDefinition(card, none).ok, true);
});

test('extra primitive fields are allowed', () => {
  const nodes = {
    n1: { t: 'List', items: '{{xs}}', template: 'n2', dir: 'row', gap: 12, wrap: true, divider: true },
    n2: { t: 'Button', label: '{{item}}', variant: 'outline', action: { name: 'pick', payload: { text: '{{item}}' } } },
  };
  assert.equal(validateDefinition(definition({ nodes, actions: ['pick'] }), none).ok, true);
});

test('props schema errors surface from validateDefinition', () => {
  const deep = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'object', properties: { d: { type: 'object' } } } } } } } } };
  assert.match(invalid(definition({ props: deep })), /deeper/);
  assert.match(invalid(definition({ props: { type: 'object', required: ['ghost'] } })), /ghost/);
});

test('compilePropSchema: required vs optional', () => {
  const schema = compilePropSchema({ type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'number' } } });
  assert.equal(schema.safeParse({ a: 'x' }).success, true);
  assert.equal(schema.safeParse({ a: 'x', b: 2 }).success, true);
  assert.equal(schema.safeParse({ b: 2 }).success, false);
  assert.equal(schema.safeParse({ a: 'x', b: 'two' }).success, false);
});

test('compilePropSchema: unknown keys are kept (passthrough)', () => {
  const schema = compilePropSchema({ type: 'object', properties: { a: { type: 'string' } } });
  assert.deepEqual(schema.parse({ a: 'x', extra: { deep: 1 } }), { a: 'x', extra: { deep: 1 } });
  const any = compilePropSchema({ type: 'object' });
  assert.deepEqual(any.parse({ component: 'Stat', props: { v: 1 } }), { component: 'Stat', props: { v: 1 } });
  assert.equal(any.safeParse('x').success, false);
});

test('compilePropSchema: enum is strict', () => {
  const schema = compilePropSchema({ type: 'object', properties: { tone: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer', enum: [1, 2] } } });
  assert.equal(schema.safeParse({ tone: 'a', n: 2 }).success, true);
  assert.equal(schema.safeParse({ tone: 'c' }).success, false);
  assert.equal(schema.safeParse({ tone: 1 }).success, false);
  assert.equal(schema.safeParse({ n: 3 }).success, false);
  assert.throws(() => compilePropSchema({ type: 'boolean', enum: [1] }));
  assert.throws(() => compilePropSchema({ type: 'string', enum: [1] }));
});

test('compilePropSchema: string accepts a finite number and coerces it', () => {
  const schema = compilePropSchema({ type: 'object', required: ['value'], properties: { value: { type: 'string' } } });
  assert.deepEqual(schema.parse({ value: 2190 }), { value: '2190' });
  assert.deepEqual(schema.parse({ value: 12.5 }), { value: '12.5' });
  assert.equal(schema.safeParse({ value: true }).success, false);
  assert.equal(schema.safeParse({ value: null }).success, false);
  assert.equal(schema.safeParse({ value: Number.NaN }).success, false);
});

test('compilePropSchema: integer and boolean', () => {
  const schema = compilePropSchema({ type: 'object', properties: { n: { type: 'integer' }, ok: { type: 'boolean' } } });
  assert.equal(schema.safeParse({ n: 1, ok: true }).success, true);
  assert.equal(schema.safeParse({ n: 1.5 }).success, false);
  assert.equal(schema.safeParse({ ok: 'yes' }).success, false);
});

test('compilePropSchema: arrays and nested objects', () => {
  const schema = compilePropSchema({
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, done: { type: 'boolean' } } },
      },
      tags: { type: 'array', items: { type: 'string' } },
      loose: { type: 'array' },
    },
  });
  assert.equal(schema.safeParse({ items: [{ title: 'a' }, { title: 'b', done: true }], tags: ['x'], loose: [1, 'a', null] }).success, true);
  assert.equal(schema.safeParse({ items: [{ done: true }] }).success, false);
  assert.equal(schema.safeParse({ items: 'nope' }).success, false);
  assert.equal(schema.safeParse({ items: [], tags: [true] }).success, false);
});

test('compilePropSchema: depth limit counts object and array levels only', () => {
  const ok = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'string' } } } } } } };
  assert.doesNotThrow(() => compilePropSchema(ok));
  // root 0, children array 1, items object 2, props object 3, scalar leaf below it: allowed.
  const instance = {
    type: 'object',
    properties: { children: { type: 'array', items: { type: 'object', properties: { props: { type: 'object', properties: { x: { type: 'number' } } } } } } },
  };
  assert.doesNotThrow(() => compilePropSchema(instance));
  const tooDeep = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'object', properties: { d: { type: 'object' } } } } } } } } };
  assert.throws(() => compilePropSchema(tooDeep), /deeper/);
  const arrays = { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'array' } } } } };
  assert.throws(() => compilePropSchema(arrays), /deeper/);
});
