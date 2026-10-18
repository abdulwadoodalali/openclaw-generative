// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUserText } from '../genui/catalog.ts';
import { describeTap } from './canvasAsk.ts';

const tasks = {
  component: 'TaskList',
  props: {
    title: 'Today',
    tasks: [
      { id: 't1', title: 'Buy milk', done: false },
      { id: 't2', title: 'Call the bank', done: true },
    ],
  },
};

test('finds the tapped item by id and names it', () => {
  const text = describeTap('Groceries', tasks, { component: 'TaskList', name: 'toggle', payload: { id: 't2' } });
  assert.ok(text.startsWith('From my "Groceries" canvas: Call the bank\n\n'));
  assert.ok(text.includes('{"id":"t2","title":"Call the bank","done":true}'));
});

test('the chat shows only the human line; Ano still gets the data', () => {
  const text = describeTap('Groceries', tasks, { component: 'TaskList', name: 'toggle', payload: { id: 't2' } });
  assert.equal(cleanUserText(text).text, 'From my "Groceries" canvas: Call the bank');
  assert.ok(text.includes('<ano-tapped>') && text.includes('"Call the bank"'));
  // Text that merely mentions the tag is left alone.
  assert.equal(cleanUserText('what is <ano-tapped> for?').text, 'what is <ano-tapped> for?');
});

test('finds items nested in children', () => {
  const card = { component: 'Card', props: { children: [tasks] } };
  const text = describeTap('Plan', card, { component: 'TaskList', name: 'toggle', payload: { id: 't1' } });
  assert.ok(text.includes('canvas: Buy milk'));
});

test('falls back to the payload text, then the component title, then its name', () => {
  assert.ok(describeTap('A', tasks, { component: 'Suggestions', name: 'pick', payload: { text: 'Add a task' } }).includes('canvas: Add a task'));
  assert.ok(describeTap('A', tasks, { component: 'TaskList', name: 'toggle', payload: { id: 'missing' } }).includes('canvas: Today'));
  assert.ok(describeTap('A', { component: 'Spacer', props: {} }, { component: 'Spacer', name: 'x', payload: {} }).includes('canvas: Spacer'));
});

test('long data is cut', () => {
  const big = { component: 'Note', props: { text: 'x'.repeat(5000) } };
  const text = describeTap('A', big, { component: 'Note', name: 'x', payload: {} });
  assert.ok(text.length < 1500);
  assert.ok(text.includes('...\n</ano-tapped>'));
});
