// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Structure of the code built-in metadata, independent of the registry's Zod compiler.
// Run: node --experimental-strip-types --test src/genui/builtins/codeMeta.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { COMPONENT_NAME_RE, LIMITS } from '../types.ts';
import { CODE_BUILTINS } from './codeMeta.ts';

const ALLOWED_KEYS = ['type', 'description', 'enum', 'items', 'properties', 'required'];
const ALLOWED_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

/** Only objects and arrays count as depth; scalar leaves are exempt (root object is depth 0). */
function containerDepth(schema) {
  const children = [...Object.values(schema.properties ?? {}), ...(schema.items ? [schema.items] : [])];
  let deepest = 0;
  for (const child of children) {
    if (child.type === 'object' || child.type === 'array') deepest = Math.max(deepest, 1 + containerDepth(child));
  }
  return deepest;
}

function checkFeatures(schema, path) {
  assert.ok(ALLOWED_TYPES.includes(schema.type), `${path}: type ${schema.type}`);
  for (const key of Object.keys(schema)) assert.ok(ALLOWED_KEYS.includes(key), `${path}: unexpected key ${key}`);
  if (schema.description !== undefined) assert.equal(typeof schema.description, 'string', `${path}: description`);
  if (schema.enum !== undefined) {
    assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${path}: enum`);
    assert.ok(schema.enum.every((v) => typeof v === 'string' || typeof v === 'number'), `${path}: enum values`);
  }
  if (schema.items !== undefined) {
    assert.equal(schema.type, 'array', `${path}: items on non-array`);
    checkFeatures(schema.items, `${path}[]`);
  }
  if (schema.properties !== undefined) {
    assert.equal(schema.type, 'object', `${path}: properties on non-object`);
    for (const [key, child] of Object.entries(schema.properties)) checkFeatures(child, `${path}.${key}`);
  }
  if (schema.required !== undefined) {
    assert.equal(schema.type, 'object', `${path}: required on non-object`);
    for (const key of schema.required) assert.ok(key in (schema.properties ?? {}), `${path}: required ${key} not declared`);
  }
}

/** Tiny structural validator: type, enum, required, items, properties (extra keys allowed). */
function check(schema, value, path = 'props') {
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected string`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected number`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      break;
    case 'array':
      if (!Array.isArray(value)) errors.push(`${path}: expected array`);
      else if (schema.items) value.forEach((item, i) => errors.push(...check(schema.items, item, `${path}[${i}]`)));
      break;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        break;
      }
      for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in value) errors.push(...check(child, value[key], `${path}.${key}`));
      }
      break;
  }
  return errors;
}

const byName = Object.fromEntries(CODE_BUILTINS.map((m) => [m.name, m]));

// Same props as MONEY_GLANCE_FENCE in scripts/mock-gateway.mjs (checked against the source below).
const MONEY_GLANCE_FIXTURE = {
  month: 'October',
  spent: 2190,
  left: 410,
  cash: 8940,
  sample: true,
  series: [12, 18, 24, 30, 37, 45, 52, 61, 70, 78, 88, 97],
};

test('code built-ins are exactly MoneyGlance, LineChart, BarChart, Collapsible, BriefItem', () => {
  assert.deepEqual(CODE_BUILTINS.map((m) => m.name), ['MoneyGlance', 'LineChart', 'BarChart', 'Collapsible', 'BriefItem']);
});

test('names are valid and unique, descriptions are short single lines', () => {
  const names = new Set();
  for (const meta of CODE_BUILTINS) {
    assert.match(meta.name, COMPONENT_NAME_RE);
    assert.ok(!names.has(meta.name), `duplicate ${meta.name}`);
    names.add(meta.name);
    assert.ok(meta.description.length > 20 && meta.description.length <= 240, `${meta.name} description length`);
    assert.ok(!meta.description.includes('\n'), `${meta.name} description is one line`);
  }
});

test('schemas use only allowed PropSchema features within the depth limit', () => {
  for (const meta of CODE_BUILTINS) {
    assert.equal(meta.props.type, 'object', `${meta.name} root`);
    checkFeatures(meta.props, meta.name);
    assert.ok(containerDepth(meta.props) <= LIMITS.maxSchemaDepth, `${meta.name} schema depth`);
  }
});

test('no em-dashes in metadata', () => {
  assert.ok(!JSON.stringify(CODE_BUILTINS).includes('\u2014'));
});

test('the mock gateway MoneyGlance fixture satisfies the schema', () => {
  assert.deepEqual(check(byName.MoneyGlance.props, MONEY_GLANCE_FIXTURE), []);
  const source = readFileSync(new URL('../../../scripts/mock-gateway.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('component: "MoneyGlance"'));
  for (const field of ['month: "October"', 'spent: 2190', 'left: 410', 'cash: 8940', 'sample: true', 'series: [12, 18, 24, 30, 37, 45, 52, 61, 70, 78, 88, 97]']) {
    assert.ok(source.includes(field), `mock gateway no longer has ${field}`);
  }
});

test('the structural checker rejects bad MoneyGlance props', () => {
  const schema = byName.MoneyGlance.props;
  assert.ok(check(schema, { ...MONEY_GLANCE_FIXTURE, spent: 'lots' }).length > 0);
  assert.ok(check(schema, { month: 'October', spent: 1 }).length > 0);
  assert.ok(check(schema, { ...MONEY_GLANCE_FIXTURE, series: [1, 'x'] }).length > 0);
});

test('LineChart and BarChart accept the documented shapes', () => {
  const points = [{ label: 'Oct 1', value: 10 }, { value: 12 }];
  assert.deepEqual(
    check(byName.LineChart.props, { title: 'Spend', format: 'money', ranges: { '1M': points, '1Y': points }, budgetLine: 11, sample: true }),
    [],
  );
  assert.deepEqual(check(byName.LineChart.props, { series: points }), []);
  assert.ok(check(byName.LineChart.props, { format: 'euro', series: points }).length > 0);
  assert.deepEqual(
    check(byName.BarChart.props, { bars: [{ label: 'Groceries', value: 420, max: 500 }, { label: 'Dining', value: 90 }] }),
    [],
  );
  assert.ok(check(byName.BarChart.props, { bars: [{ value: 1 }] }).length > 0);
  assert.ok(check(byName.BarChart.props, {}).length > 0);
});

test('Collapsible accepts nested instances and rejects missing title or children', () => {
  const schema = byName.Collapsible.props;
  const child = { component: 'TaskList', props: { tasks: [{ id: 'a', title: 'x' }] } };
  assert.deepEqual(check(schema, { title: 'Today', subtitle: '2 tasks', open: true, children: [child, child] }), []);
  assert.ok(check(schema, { children: [child] }).length > 0);
  assert.ok(check(schema, { title: 'Today' }).length > 0);
  assert.ok(check(schema, { title: 'Today', children: [{ props: {} }] }).length > 0);
});

test('BriefItem takes the card contract, needs a title, and still accepts old cards', () => {
  const schema = byName.BriefItem.props;
  const full = {
    id: 'hydro-oct',
    kind: 'decide',
    title: 'Hydro bill $214 due Friday',
    why: 'Autopay is off this month',
    stake: '$214',
    agent: 'finance',
    source: 'Budget',
    at: '2026-10-15T08:00:00Z',
    action: { label: 'Pay', prompt: 'Pay the Hydro bill' },
  };
  assert.deepEqual(check(schema, full), []);
  assert.deepEqual(check(schema, { ...full, kind: 'answer', options: ['Yes', 'No'] }), []);
  assert.deepEqual(check(schema, { kind: 'today', title: 'Today', events: [{ time: '14:00', title: 'Dentist' }] }), []);
  assert.deepEqual(check(schema, { title: 'Reply to Commercial Ops', detail: 'Due Friday', tone: 'household' }), []);
  assert.ok(check(schema, { why: 'no title' }).length > 0);
  assert.ok(check(schema, { ...full, kind: 'urgent' }).length > 0);
  assert.ok(check(schema, { ...full, action: { label: 'Go' } }).length > 0);
  assert.ok(check(schema, { kind: 'today', title: 'Today', events: [{ title: 'No time' }] }).length > 0);
});
