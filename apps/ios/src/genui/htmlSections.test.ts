// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/htmlSections.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFenceTransformer } from './fenceTransformer.ts';
import { parseBlocks, stripHtml } from './htmlSections.ts';
import { toolCallMarker } from './proseMarkers.ts';

const M = toolCallMarker;
const CTX = { messageId: 'm1', runId: 'r1', sessionKey: 'k' };

test('plain markdown is one block; markers split it in order', () => {
  assert.deepEqual(parseBlocks('hello **there**'), [{ type: 'markdown', text: 'hello **there**' }]);
  assert.deepEqual(parseBlocks(`intro\n\n${M(0)}\n\nmiddle\n\n${M(1)}`), [
    { type: 'markdown', text: 'intro' },
    { type: 'call', index: 0 },
    { type: 'markdown', text: 'middle' },
    { type: 'call', index: 1 },
  ]);
});

test('details with summary becomes a details block, any case and loose whitespace', () => {
  const blocks = parseBlocks('Before\n\n<DETAILS >\n  < summary>x</summary>\n</details>\n');
  assert.equal(blocks[0].type, 'markdown');
  const loose = parseBlocks('<details>\n<SUMMARY>Overdue (2)</SUMMARY>\n\nbody text\n</details>');
  assert.deepEqual(loose, [{ type: 'details', summary: 'Overdue (2)', open: false, blocks: [{ type: 'markdown', text: 'body text' }] }]);
  const open = parseBlocks('<details open><summary>**Now**</summary>x</details>');
  assert.equal(open[0].open, true);
  assert.equal(open[0].summary, 'Now');
});

test('a details body keeps markers so cards render inside it', () => {
  const blocks = parseBlocks(`<details>\n<summary>Today</summary>\n\n${M(0)}\n\n</details>\n\n<details><summary>Later</summary>\n\n${M(1)}\n\n</details>`);
  assert.deepEqual(blocks, [
    { type: 'details', summary: 'Today', open: false, blocks: [{ type: 'call', index: 0 }] },
    { type: 'details', summary: 'Later', open: false, blocks: [{ type: 'call', index: 1 }] },
  ]);
});

test('unclosed details runs to the end; stray closers and other tags never show', () => {
  assert.deepEqual(parseBlocks('<details><summary>A</summary>text'), [
    { type: 'details', summary: 'A', open: false, blocks: [{ type: 'markdown', text: 'text' }] },
  ]);
  assert.deepEqual(parseBlocks('a</details> <b>bold</b><br/>c <div class="x">d</div>'), [{ type: 'markdown', text: 'a bold\nc d' }]);
  assert.deepEqual(parseBlocks('<details><summ'), []);
});

test('nested details nest; code and autolinks are left alone', () => {
  const nested = parseBlocks('<details><summary>Outer</summary><details><summary>Inner</summary>x</details>y</details>');
  assert.equal(nested.length, 1);
  assert.deepEqual(nested[0].blocks.map((b) => b.type), ['details', 'markdown']);
  const code = parseBlocks('```html\n<details><summary>x</summary></details>\n```\nUse `<b>` here and <https://example.com>.');
  assert.deepEqual(code, [
    { type: 'markdown', text: '```html\n<details><summary>x</summary></details>\n```\nUse `<b>` here and <https://example.com>.' },
  ]);
  assert.equal(stripHtml('a <!-- note --> b'), 'a  b');
});

test('the todo reply with details around ano-ui TaskLists renders as collapsibles holding the cards', () => {
  const taskList = (title, tasks) => `\`\`\`ano-ui\n${JSON.stringify({ component: 'TaskList', props: { title, tasks } })}\n\`\`\``;
  const reply = [
    '**Ano** Here are your todos, grouped.',
    '<details>\n<summary>Overdue (1)</summary>',
    taskList('Overdue', [{ id: 'a', title: 'Pay rent' }]),
    '</details>',
    '<details>\n<summary>This week (2)</summary>',
    taskList('This week', [{ id: 'b', title: 'Call dentist' }, { id: 'c', title: 'Book flights' }]),
    '</details>',
    'Want me to move any of these?',
  ].join('\n\n');
  const m = createFenceTransformer(CTX).toMessage(reply);
  assert.equal(m.toolCalls.length, 2);
  const blocks = parseBlocks(m.content);
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['markdown', 'details', 'details', 'markdown'],
  );
  assert.deepEqual(blocks[1], { type: 'details', summary: 'Overdue (1)', open: false, blocks: [{ type: 'call', index: 0 }] });
  assert.deepEqual(blocks[2], { type: 'details', summary: 'This week (2)', open: false, blocks: [{ type: 'call', index: 1 }] });
  assert.ok(!JSON.stringify(blocks).includes('<details'));
});
