// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/genericView.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenericModel, humanize, propsFromSource } from './genericView.ts';

test('humanize', () => {
  assert.equal(humanize('KanbanBoard'), 'Kanban board');
  assert.equal(humanize('due_date'), 'Due date');
  assert.equal(humanize('TaskListV2'), 'Task list v2');
});

test('unknown KanbanBoard: titled card, columns as rows with their items', () => {
  const props = { title: 'Sprint', columns: [{ name: 'Todo', items: ['a', 'b'] }, { name: 'Done', items: [] }] };
  assert.deepEqual(buildGenericModel('KanbanBoard', props), {
    title: 'Sprint',
    sections: [{ kind: 'rows', label: 'Columns', rows: [{ title: 'Todo', secondary: 'a, b' }, { title: 'Done' }] }],
  });
});

test('title falls back to label, name, then the humanized component name', () => {
  assert.equal(buildGenericModel('X', { label: 'L' }).title, 'L');
  assert.equal(buildGenericModel('X', { name: 'N' }).title, 'N');
  assert.equal(buildGenericModel('KanbanBoard', {}).title, 'Kanban board');
});

test('scalars become label/value rows, arrays of strings bullets, nested instances nodes', () => {
  const model = buildGenericModel('Thing', {
    title: 'T',
    owner: 'Sam',
    done: false,
    count: 3,
    tags: ['x', 'y'],
    children: [{ component: 'Badge', props: { text: 'hi' } }],
    inner: { component: 'Stat', props: { label: 'a', value: 1 } },
    meta: { by: 'me' },
  });
  assert.deepEqual(model.sections, [
    {
      kind: 'fields',
      rows: [
        { label: 'Owner', value: 'Sam' },
        { label: 'Done', value: 'No' },
        { label: 'Count', value: '3' },
        { label: 'Meta by', value: 'me' },
      ],
    },
    { kind: 'bullets', label: 'Tags', items: ['x', 'y'] },
    { kind: 'nodes', nodes: [{ component: 'Badge', props: { text: 'hi' } }] },
    { kind: 'nodes', label: 'Inner', nodes: [{ component: 'Stat', props: { label: 'a', value: 1 } }] },
  ]);
});

test('list rows pick a title field and a secondary field', () => {
  const model = buildGenericModel('List', { entries: [{ id: 1, label: 'Rent', amount: 1200, due: 'Oct 1' }, { text: 'Solo' }] });
  assert.deepEqual(model.sections[0].rows, [{ title: 'Rent', secondary: '1200 \u00b7 Oct 1' }, { title: 'Solo' }]);
});

test('propsFromSource takes the props of a fence body, bare objects, and null for non-JSON', () => {
  assert.deepEqual(propsFromSource('{"component":"A","props":{"x":1}}'), { x: 1 });
  assert.deepEqual(propsFromSource('{"x":1}'), { x: 1 });
  assert.equal(propsFromSource('{oops'), null);
  assert.equal(propsFromSource('[1]'), null);
});
