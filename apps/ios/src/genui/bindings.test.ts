// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/bindings.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { FILTERS, isTruthyBinding, resolveTemplate } from './bindings.ts';

const scope = {
  props: {
    label: 'Groceries',
    spent: 482.5,
    budget: 600,
    big: 12345.67,
    ratio: 0.425,
    done: false,
    due: '2026-10-12T09:30:00Z',
    nothing: null,
    items: [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }],
    nested: { deep: { value: 7 } },
    tricky: '{{label}}',
  },
  item: { id: 'x1', title: 'Milk', qty: 2 },
  index: 3,
  state: { range: '3M', open: true },
};

test('a single binding keeps the raw typed value', () => {
  assert.equal(resolveTemplate('{{spent}}', scope), 482.5);
  assert.equal(resolveTemplate('{{done}}', scope), false);
  assert.equal(resolveTemplate('{{nothing}}', scope), null);
  assert.equal(resolveTemplate('{{missing}}', scope), undefined);
  assert.deepEqual(resolveTemplate('{{items}}', scope), scope.props.items);
  assert.equal(resolveTemplate('  {{ spent }}', scope), '  482.5', 'surrounding text makes it a string');
});

test('mixed strings interpolate to text; null and undefined become empty', () => {
  assert.equal(resolveTemplate('{{label}}: {{spent}} of {{budget}}', scope), 'Groceries: 482.5 of 600');
  assert.equal(resolveTemplate('a{{nothing}}b{{missing}}c', scope), 'abc');
  assert.equal(resolveTemplate('flag={{done}}', scope), 'flag=false');
  assert.equal(resolveTemplate('plain text', scope), 'plain text');
});

test('paths: props, nested, item, index, state', () => {
  assert.equal(resolveTemplate('{{nested.deep.value}}', scope), 7);
  assert.equal(resolveTemplate('{{items.1.title}}', scope), 'Two');
  assert.equal(resolveTemplate('{{item.title}}', scope), 'Milk');
  assert.equal(resolveTemplate('{{item.qty}}', scope), 2);
  assert.equal(resolveTemplate('{{index}}', scope), 3);
  assert.equal(resolveTemplate('{{state.range}}', scope), '3M');
  assert.equal(resolveTemplate('{{state.nope}}', scope), undefined);
  assert.equal(resolveTemplate('{{nested.nope.value}}', scope), undefined);
  assert.equal(resolveTemplate('{{item.title}}', { props: {}, state: {} }), undefined);
});

test('filter: money', () => {
  assert.equal(FILTERS.money(1234), '$1,234');
  assert.equal(FILTERS.money(12345.67), '$12,346');
  assert.equal(FILTERS.money(410), '$410');
  assert.equal(FILTERS.money(12.5), '$12.50');
  assert.equal(FILTERS.money(0.5), '$0.50');
  assert.equal(FILTERS.money(-3), '-$3');
  assert.equal(FILTERS.money(-1500.4), '-$1,500');
  assert.equal(FILTERS.money('2190'), '$2,190');
  assert.equal(FILTERS.money('n/a'), 'n/a');
  assert.equal(resolveTemplate('{{big|money}}', scope), '$12,346');
  assert.equal(resolveTemplate('{{spent | money}} of {{budget|money}}', scope), '$482.50 of $600');
});

test('filter: percent', () => {
  assert.equal(FILTERS.percent(0.42), '42%');
  assert.equal(FILTERS.percent(0.425), '42.5%');
  assert.equal(FILTERS.percent(42), '42%', 'above 1 is already percent');
  assert.equal(FILTERS.percent(1), '100%');
  assert.equal(FILTERS.percent(0), '0%');
  assert.equal(FILTERS.percent('x'), 'x');
  assert.equal(resolveTemplate('{{ratio|percent}}', scope), '42.5%');
});

test('filter: date', () => {
  assert.equal(FILTERS.date('2026-10-12'), 'Oct 12');
  assert.equal(FILTERS.date('2026-01-05T23:59:00-05:00'), 'Jan 5');
  assert.equal(FILTERS.date('not a date'), 'not a date');
  assert.equal(FILTERS.date('2026-13-40'), '2026-13-40');
  assert.equal(FILTERS.date(5), 5);
  assert.equal(resolveTemplate('Due {{due|date}}', scope), 'Due Oct 12');
});

test('filter: upper and round', () => {
  assert.equal(FILTERS.upper('abc'), 'ABC');
  assert.equal(FILTERS.upper(5), 5);
  assert.equal(FILTERS.round(2.5), 3);
  assert.equal(FILTERS.round(-2.4), -2);
  assert.equal(FILTERS.round('7.6'), 8);
  assert.equal(FILTERS.round('abc'), 'abc');
  assert.equal(resolveTemplate('{{label|upper}}', scope), 'GROCERIES');
  assert.equal(resolveTemplate('{{spent|round}}', scope), 483);
});

test('filters chain left to right', () => {
  assert.equal(resolveTemplate('{{spent|round|money}}', scope), '$483');
  assert.equal(resolveTemplate('{{label|upper|upper}}', scope), 'GROCERIES');
});

test('objects and arrays resolve recursively; other values pass through', () => {
  const input = {
    id: '{{item.id}}',
    label: 'Row {{index}}: {{item.title}}',
    list: ['{{spent}}', 5, null, true, { n: '{{budget|money}}' }],
    n: 4,
  };
  assert.deepEqual(resolveTemplate(input, scope), {
    id: 'x1',
    label: 'Row 3: Milk',
    list: [482.5, 5, null, true, { n: '$600' }],
    n: 4,
  });
  assert.equal(resolveTemplate(12, scope), 12);
  assert.equal(resolveTemplate(undefined, scope), undefined);
  assert.equal(resolveTemplate(null, scope), null);
});

test('bound values are not re-scanned for bindings', () => {
  assert.equal(resolveTemplate('{{tricky}}', scope), '{{label}}');
  assert.equal(resolveTemplate('x {{tricky}}', scope), 'x {{label}}');
});


test('malformed templates stay literal and never throw', () => {
  assert.equal(resolveTemplate('{{spent', scope), '{{spent');
  assert.equal(resolveTemplate('open {{ and {{label}}', scope), 'open {{ and {{label}}');
  assert.equal(resolveTemplate('{{}}', scope), '{{}}');
  assert.equal(resolveTemplate('{{ }}', scope), '{{ }}');
  assert.equal(resolveTemplate('{{a b}}', scope), '{{a b}}');
  assert.equal(resolveTemplate('{{spent|nope}}', scope), '{{spent|nope}}');
  assert.equal(resolveTemplate('cost {{spent|nope}} now', scope), 'cost {{spent|nope}} now');
  assert.equal(resolveTemplate('{{1abc}}', scope), '{{1abc}}');
  assert.equal(resolveTemplate('{{spent.}}', scope), '{{spent.}}');
  assert.equal(resolveTemplate('{{a..b}}', scope), '{{a..b}}');
  assert.equal(resolveTemplate('{{spent + 1}}', scope), '{{spent + 1}}');
  assert.equal(resolveTemplate('{{alert(1)}}', scope), '{{alert(1)}}');
  assert.equal(resolveTemplate('}}{{', scope), '}}{{');
});

test('prototype paths are blocked', () => {
  const props = { label: 'x', obj: { a: 1 }, list: [1, 2] };
  const s = { props, item: { a: 1 }, index: 0, state: {} };
  for (const path of [
    '__proto__',
    'constructor',
    'prototype',
    'label.constructor',
    'obj.__proto__',
    'obj.constructor.name',
    'obj.prototype',
    'item.constructor',
    'item.__proto__.toString',
    'state.__proto__',
    'toString',
    'hasOwnProperty',
  ]) {
    assert.equal(resolveTemplate(`{{${path}}}`, s), undefined, path);
    assert.equal(isTruthyBinding(`{{${path}}}`, s), false, path);
  }
  assert.equal(resolveTemplate('a{{obj.constructor}}b', s), 'ab');
  assert.equal(Object.getPrototypeOf(resolveTemplate({ ['__proto__']: 1, ok: 2 }, s)), Object.prototype);
  assert.deepEqual(Object.keys(resolveTemplate(JSON.parse('{"__proto__": {"x": 1}, "ok": 2}'), s)), ['ok']);
});

test('unknown filter names inherited from Object.prototype are not filters', () => {
  assert.equal(resolveTemplate('{{label|constructor}}', scope), '{{label|constructor}}');
  assert.equal(resolveTemplate('{{label|toString}}', scope), '{{label|toString}}');
});

test('isTruthyBinding', () => {
  assert.equal(isTruthyBinding('{{label}}', scope), true);
  assert.equal(isTruthyBinding('{{spent}}', scope), true);
  assert.equal(isTruthyBinding('{{done}}', scope), false);
  assert.equal(isTruthyBinding('{{nothing}}', scope), false);
  assert.equal(isTruthyBinding('{{missing}}', scope), false);
  assert.equal(isTruthyBinding('{{items}}', scope), true);
  assert.equal(isTruthyBinding('{{state.open}}', scope), true);
  assert.equal(isTruthyBinding('{{index}}', { ...scope, index: 0 }), false);
  assert.equal(isTruthyBinding('{{label}}', { ...scope, props: { label: '' } }), false);
  assert.equal(isTruthyBinding('{{items}}', { ...scope, props: { items: [] } }), false);
  assert.equal(isTruthyBinding('state.open', scope), true, 'bare path');
  assert.equal(isTruthyBinding('{{spent|nope}}', scope), false, 'unknown filter is falsy');
  assert.equal(isTruthyBinding('garbage {{ ', scope), false);
  assert.equal(isTruthyBinding('', scope), false);
});
