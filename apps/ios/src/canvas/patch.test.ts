// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/canvas/patch.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPatch, applyVersionedPatch } from './patch.ts';

const block = (name, props = {}) => ({ component: name, props });
const body = () => ({
  title: 'Week',
  blocks: [block('Card', { title: 'One' }), block('Stat', { label: 'Two', value: '2' }), block('TaskList', { items: ['a', 'b'] })],
});
const names = (b) => b.blocks.map((x) => x.component);

test('add inserts at an index and appends with "-"', () => {
  const first = applyPatch(body(), [{ op: 'add', path: '/blocks/1', value: block('Note') }]);
  assert.ok(first.ok);
  assert.deepEqual(names(first.body), ['Card', 'Note', 'Stat', 'TaskList']);
  const last = applyPatch(body(), [{ op: 'add', path: '/blocks/-', value: block('Note') }]);
  assert.ok(last.ok);
  assert.deepEqual(names(last.body), ['Card', 'Stat', 'TaskList', 'Note']);
});

test('add can set a prop and a list item inside a block', () => {
  const result = applyPatch(body(), [
    { op: 'add', path: '/blocks/0/props/subtitle', value: 'hi' },
    { op: 'add', path: '/blocks/2/props/items/-', value: 'c' },
  ]);
  assert.ok(result.ok);
  assert.equal(result.body.blocks[0].props.subtitle, 'hi');
  assert.deepEqual(result.body.blocks[2].props.items, ['a', 'b', 'c']);
});

test('replace swaps a block, a prop and the title', () => {
  const result = applyPatch(body(), [
    { op: 'replace', path: '/blocks/1', value: block('Note', { text: 'x' }) },
    { op: 'replace', path: '/blocks/0/props/title', value: 'Uno' },
    { op: 'replace', path: '/title', value: 'Next week' },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(names(result.body), ['Card', 'Note', 'TaskList']);
  assert.equal(result.body.blocks[0].props.title, 'Uno');
  assert.equal(result.body.title, 'Next week');
});

test('remove deletes blocks and props', () => {
  const result = applyPatch(body(), [
    { op: 'remove', path: '/blocks/0' },
    { op: 'remove', path: '/blocks/0/props/label' },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(names(result.body), ['Stat', 'TaskList']);
  assert.deepEqual(result.body.blocks[0].props, { value: '2' });
});

test('move reorders blocks', () => {
  const up = applyPatch(body(), [{ op: 'move', from: '/blocks/2', path: '/blocks/0' }]);
  assert.ok(up.ok);
  assert.deepEqual(names(up.body), ['TaskList', 'Card', 'Stat']);
  const toEnd = applyPatch(body(), [{ op: 'move', from: '/blocks/0', path: '/blocks/-' }]);
  assert.ok(toEnd.ok);
  assert.deepEqual(names(toEnd.body), ['Stat', 'TaskList', 'Card']);
});

test('ops apply in order, each seeing the previous result', () => {
  const result = applyPatch(body(), [
    { op: 'remove', path: '/blocks/0' },
    { op: 'replace', path: '/blocks/0', value: block('Note') },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(names(result.body), ['Note', 'TaskList']);
});

test('the input body is never modified and the result shares no structure with it', () => {
  const input = body();
  const copy = JSON.parse(JSON.stringify(input));
  const value = block('Note', { nested: { a: 1 } });
  const result = applyPatch(input, [
    { op: 'replace', path: '/blocks/0/props/title', value: 'changed' },
    { op: 'add', path: '/blocks/-', value },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(input, copy);
  assert.notEqual(result.body.blocks[1], input.blocks[1]);
  value.props.nested.a = 2;
  assert.equal(result.body.blocks[3].props.nested.a, 1);
});

test('bad paths are readable errors naming the op', () => {
  const cases = [
    [{ op: 'replace', path: '/blocks/9', value: block('Note') }, /ops\[0\] \(replace\).*does not exist/],
    [{ op: 'remove', path: '/blocks/7' }, /does not exist/],
    [{ op: 'add', path: '/blocks/9', value: block('Note') }, /out of range/],
    [{ op: 'add', path: '/blocks/x', value: block('Note') }, /out of range/],
    [{ op: 'add', path: '/blocks/0/props/a/b', value: 1 }, /does not exist/],
    [{ op: 'replace', path: '/blocks/0/props/missing', value: 1 }, /does not exist/],
    [{ op: 'replace', path: 'blocks/0', value: block('Note') }, /must start with \//],
    [{ op: 'add', path: '/other', value: 1 }, /must be \/title or \/blocks/],
    [{ op: 'add', path: '/blocks/0/props/__proto__', value: 1 }, /not allowed/],
    [{ op: 'move', from: '/blocks/5', path: '/blocks/0' }, /does not exist/],
  ];
  for (const [op, pattern] of cases) {
    const result = applyPatch(body(), [op]);
    assert.equal(result.ok, false, JSON.stringify(op));
    assert.match(result.error, pattern, JSON.stringify(op));
  }
});

test('a patch that leaves an invalid canvas is rejected', () => {
  const badBlock = applyPatch(body(), [{ op: 'add', path: '/blocks/-', value: { component: 'not valid', props: {} } }]);
  assert.equal(badBlock.ok, false);
  assert.match(badBlock.error, /invalid canvas/);
  const noTitle = applyPatch(body(), [{ op: 'remove', path: '/title' }]);
  assert.equal(noTitle.ok, false);
  const tooMany = applyPatch(
    { title: 'x', blocks: Array.from({ length: 40 }, () => block('Card')) },
    [{ op: 'add', path: '/blocks/-', value: block('Card') }],
  );
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /maximum is 40/);
});

test('a stale base is still applied when the ops apply cleanly', () => {
  const result = applyVersionedPatch(body(), 5, { base: 2, ops: [{ op: 'replace', path: '/blocks/0/props/title', value: 'ok' }] });
  assert.ok(result.ok);
  assert.equal(result.body.blocks[0].props.title, 'ok');
});

test('a stale base that no longer applies reports that the canvas changed', () => {
  const result = applyVersionedPatch(body(), 5, { base: 2, ops: [{ op: 'remove', path: '/blocks/8' }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /^canvas changed since version 2/);
});

test('a failing patch against the current base reports the op error, not a version problem', () => {
  const result = applyVersionedPatch(body(), 5, { base: 5, ops: [{ op: 'remove', path: '/blocks/8' }] });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /canvas changed/);
  const noBase = applyVersionedPatch(body(), 5, { ops: [{ op: 'remove', path: '/blocks/8' }] });
  assert.doesNotMatch(noBase.error, /canvas changed/);
});
