// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/genui/fences.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FENCE_BYTES, decodeFence, detectComponentName, parseSegments, toolCallFor } from './fences.ts';
import { LIMITS } from './types.ts';

const UI = '```ano-ui\n{"component":"MoneyGlance","props":{"spent":10}}\n```';

test('MAX_FENCE_BYTES comes from the shared limits', () => {
  assert.equal(MAX_FENCE_BYTES, LIMITS.maxFenceBytes);
});

test('plain text only', () => {
  assert.deepEqual(parseSegments('**Ano** Hello there\n\nSecond paragraph'), [
    { kind: 'text', text: '**Ano** Hello there\n\nSecond paragraph' },
  ]);
  assert.deepEqual(parseSegments(''), []);
  assert.deepEqual(parseSegments('\n\n  \n'), []);
});

test('text + ui fence + text', () => {
  const segs = parseSegments(`**Ano** Here you go.\n\n${UI}\n\nAnd a closing line.\n`);
  assert.deepEqual(segs, [
    { kind: 'text', text: '**Ano** Here you go.' },
    { kind: 'ui', json: '{"component":"MoneyGlance","props":{"spent":10}}', complete: true },
    { kind: 'text', text: 'And a closing line.' },
  ]);
});

test('two fences back to back', () => {
  const segs = parseSegments(`${UI}\n${UI}\n`);
  assert.deepEqual(
    segs.map((s) => s.kind),
    ['ui', 'ui'],
  );
  assert.ok(segs.every((s) => s.complete));
});

test('define fence', () => {
  const body = '{"name":"BudgetBar","version":1}';
  const segs = parseSegments(`Sure.\n\n\`\`\`ano-define\n${body}\n\`\`\`\n\nUse it.`);
  assert.deepEqual(segs, [
    { kind: 'text', text: 'Sure.' },
    { kind: 'define', json: body, complete: true },
    { kind: 'text', text: 'Use it.' },
  ]);
});

test('opener tolerates up to 3 leading spaces, trailing spaces and CRLF', () => {
  const segs = parseSegments('Hi\r\n   ```ano-ui  \r\n{"component":"A"}\r\n  ```  \r\nBye');
  assert.deepEqual(segs, [
    { kind: 'text', text: 'Hi' },
    { kind: 'ui', json: '{"component":"A"}', complete: true },
    { kind: 'text', text: 'Bye' },
  ]);
});

test('unclosed fence: incomplete while streaming, plain text at final', () => {
  const raw = 'Look:\n\n```ano-ui\n{"component":"MoneyGl';
  assert.deepEqual(parseSegments(raw), [
    { kind: 'text', text: 'Look:' },
    { kind: 'ui', json: '{"component":"MoneyGl', complete: false },
  ]);
  assert.deepEqual(parseSegments(raw, { final: true }), [
    { kind: 'text', text: 'Look:\n\n```ano-ui\n{"component":"MoneyGl' },
  ]);
});

test('a closing line without a newline closes only at final', () => {
  const raw = '```ano-ui\n{"component":"A"}\n```';
  assert.deepEqual(parseSegments(raw), [{ kind: 'ui', json: '{"component":"A"}', complete: false }]);
  assert.deepEqual(parseSegments(raw, { final: true }), [{ kind: 'ui', json: '{"component":"A"}', complete: true }]);
});

test('an ano fence inside another code block stays text', () => {
  const raw = `Example:\n\n\`\`\`ts\n${UI}\n\`\`\`\n\nDone.`;
  const segs = parseSegments(raw);
  assert.deepEqual(segs, [{ kind: 'text', text: raw }]);
  // a bare fence and an unclosed other block behave the same
  assert.deepEqual(parseSegments(`\`\`\`\n${UI}\n\`\`\``).map((s) => s.kind), ['text']);
  assert.deepEqual(parseSegments(`\`\`\`json\n${UI}\n`).map((s) => s.kind), ['text']);
  // and a real fence after the other block closed is still parsed
  assert.deepEqual(parseSegments(`\`\`\`ts\nlet a;\n\`\`\`\n${UI}`).map((s) => s.kind), ['text', 'ui']);
});

test('info strings that are not exactly ano-ui / ano-define are ordinary code blocks', () => {
  const raw = '```ano-uix\n{"component":"A"}\n```';
  assert.deepEqual(parseSegments(raw), [{ kind: 'text', text: raw }]);
});

test('oversize fence degrades to text (closed and unclosed)', () => {
  const big = `{"component":"A","props":{"s":"${'x'.repeat(MAX_FENCE_BYTES)}"}}`;
  const closed = `Hi\n\n\`\`\`ano-ui\n${big}\n\`\`\`\n\nBye`;
  assert.deepEqual(parseSegments(closed), [{ kind: 'text', text: closed }]);
  const open = `Hi\n\n\`\`\`ano-ui\n${big}`;
  assert.deepEqual(parseSegments(open), [{ kind: 'text', text: open }]);
});

test('oversize is measured in bytes', () => {
  const multi = 'é'.repeat(MAX_FENCE_BYTES / 2); // 2 bytes each: exactly the limit once wrapped below
  const ok = `\`\`\`ano-ui\n${multi}\n\`\`\``;
  assert.equal(parseSegments(ok)[0].kind, 'ui');
  const over = `\`\`\`ano-ui\n${multi}é\n\`\`\``;
  assert.equal(parseSegments(over)[0].kind, 'text');
});

test('keepFailed keeps oversize and unclosed-at-final fences as fence segments with an error', () => {
  const big = 'x'.repeat(MAX_FENCE_BYTES + 1);
  const over = parseSegments(`\`\`\`ano-ui\n${big}\n\`\`\`\n`, { keepFailed: true });
  assert.deepEqual(over, [{ kind: 'ui', json: big, complete: true, error: 'oversize' }]);
  const unclosed = parseSegments('A\n\n```ano-define\n{"name":"X"', { final: true, keepFailed: true });
  assert.deepEqual(unclosed, [
    { kind: 'text', text: 'A' },
    { kind: 'define', json: '{"name":"X"', complete: false, error: 'unclosed' },
  ]);
  const streaming = parseSegments('A\n\n```ano-define\n{"name":"X"', { keepFailed: true });
  assert.equal(streaming[1].error, undefined);
});

test('bad json fences parse as segments; toolCallFor says null', () => {
  const segs = parseSegments('```ano-ui\n{not json}\n```\n');
  assert.deepEqual(segs, [{ kind: 'ui', json: '{not json}', complete: true }]);
  assert.equal(toolCallFor(segs[0]), null);
});

test('partial opener at the end is held back while streaming and text at final', () => {
  for (const tail of ['`', '``', '```', '```a', '```ano-u', '```ano-ui', '```ano-ui  ', '```ano-define', '  ```ano-d']) {
    const raw = `Before\n${tail}`;
    assert.deepEqual(parseSegments(raw), [{ kind: 'text', text: 'Before' }], JSON.stringify(tail));
    assert.deepEqual(parseSegments(raw, { final: true }), [{ kind: 'text', text: `Before\n${tail}`.trimEnd() }], JSON.stringify(tail));
  }
  // a tail that cannot become an opener is text right away
  assert.deepEqual(parseSegments('Before\n```ts'), [{ kind: 'text', text: 'Before\n```ts' }]);
  assert.deepEqual(parseSegments('Before\n```x'), [{ kind: 'text', text: 'Before\n```x' }]);
  // inline backticks mid-line are never held back
  assert.deepEqual(parseSegments('use `code`'), [{ kind: 'text', text: 'use `code`' }]);
  // the completed opener (newline) turns the held tail into an incomplete fence
  assert.deepEqual(parseSegments('Before\n```ano-ui\n'), [
    { kind: 'text', text: 'Before' },
    { kind: 'ui', json: '', complete: false },
  ]);
});

test('a partial closing line is not part of the incomplete body', () => {
  assert.deepEqual(parseSegments('```ano-ui\n{"component":"A"}\n``'), [
    { kind: 'ui', json: '{"component":"A"}', complete: false },
  ]);
});

test('toolCallFor: ui', () => {
  const call = (json) => toolCallFor({ kind: 'ui', json, complete: true });
  assert.deepEqual(call('{"component":"MoneyGlance","props":{"a":1}}'), { name: 'render_MoneyGlance', args: { a: 1 } });
  assert.deepEqual(call('{"component":"Suggestions"}'), { name: 'render_Suggestions', args: {} });
  assert.equal(call('{"component":"Bad-Name"}'), null);
  assert.equal(call('{"component":"1Bad"}'), null);
  assert.equal(call('{"props":{}}'), null);
  assert.equal(call('{"component":"A","props":[1]}'), null);
  assert.equal(call('[1,2]'), null);
  assert.equal(call('null'), null);
  assert.equal(call('"str"'), null);
  assert.equal(toolCallFor({ kind: 'ui', json: '{"component":"A"}', complete: false }), null);
});

test('toolCallFor: define', () => {
  const call = (json) => toolCallFor({ kind: 'define', json, complete: true });
  const def = { name: 'BudgetBar', version: 1, nodes: { n1: { t: 'Text' } } };
  assert.deepEqual(call(JSON.stringify(def)), { name: 'define_component', args: def });
  assert.equal(call('{"version":1}'), null);
  assert.equal(call('{"name":"no spaces allowed"}'), null);
  assert.equal(call('{"name":3}'), null);
  assert.equal(call('{oops'), null);
});

test('detectComponentName', () => {
  assert.equal(detectComponentName('{"component":"MoneyGlance","props":{}}'), 'MoneyGlance');
  assert.equal(detectComponentName('{ "component" :  "Stat"'), 'Stat');
  assert.equal(detectComponentName('{\n  "component": "Stat"'), 'Stat');
  assert.equal(detectComponentName('{"component":"Mon'), null); // closing quote required
  assert.equal(detectComponentName('{"component":"'), null);
  assert.equal(detectComponentName('{"component'), null);
  assert.equal(detectComponentName('{"props":{},"component":"Stat"}'), null);
  assert.equal(detectComponentName('{"component":"Bad-Name"}'), null);
  assert.equal(detectComponentName('{"component":"1Bad"}'), null);
  assert.equal(detectComponentName(''), null);
});

// ---- prefix stability property ------------------------------------------------------------

const SAMPLE = [
  '**Ano** Here is your October snapshot.',
  '',
  '```ano-ui',
  '{"component":"MoneyGlance","props":{"month":"October","series":[1,2,3]}}',
  '```',
  '',
  'Spending is **slightly ahead**. Code:',
  '',
  '```ts',
  '```ano-ui',
  '{"component":"Nested"}',
  '```',
  '',
  '```ano-ui',
  '{"component":"Suggestions","props":{"options":["a","b"]}}',
  '```',
  '```ano-define',
  '{"name":"BudgetBar","version":1}',
  '```',
  'The end `inline` ``` not a fence',
  '',
].join('\n');

function isPrefixStable(prefix, full) {
  for (let i = 0; i < prefix.length; i++) {
    const p = prefix[i];
    const f = full[i];
    if (!f || p.kind !== f.kind) return false;
    if (p.kind === 'text') {
      if (!f.text.startsWith(p.text)) return false;
    } else if (p.complete) {
      if (!f.complete || p.json !== f.json) return false;
    } else if (!f.json.startsWith(p.json)) {
      return false;
    }
    // everything but the last segment of the prefix is finished and must be unchanged
    if (i < prefix.length - 1) {
      if (p.kind === 'text' ? f.text !== p.text : p.json !== f.json) return false;
    }
  }
  return true;
}

test('prefix stability: every prefix parses to a prefix of the full parse', () => {
  const full = parseSegments(SAMPLE, { final: true });
  assert.deepEqual(
    full.map((s) => s.kind),
    ['text', 'ui', 'text', 'ui', 'define', 'text'],
  );
  for (let i = 0; i <= SAMPLE.length; i++) {
    const prefix = parseSegments(SAMPLE.slice(0, i));
    assert.ok(isPrefixStable(prefix, full), `prefix of length ${i}: ${JSON.stringify(SAMPLE.slice(0, i).slice(-30))}`);
  }
});

test('prefix stability holds with the sample split in random chunks', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const reference = parseSegments(SAMPLE, { final: true });
  for (let round = 0; round < 50; round++) {
    let pos = 0;
    let previous = [];
    while (pos < SAMPLE.length) {
      pos = Math.min(SAMPLE.length, pos + 1 + Math.floor(rand() * 12));
      const now = parseSegments(SAMPLE.slice(0, pos));
      assert.ok(isPrefixStable(previous, now), `round ${round} pos ${pos}`);
      assert.ok(isPrefixStable(now, reference), `round ${round} pos ${pos} vs full`);
      previous = now;
    }
  }
});

test('canvas fence is a canvas segment and decodes to canvas_update', () => {
  const body = '{"op":"create","title":"Groceries","blocks":[]}';
  const segs = parseSegments(`Saved.\n\n\`\`\`ano-canvas\n${body}\n\`\`\`\n`);
  assert.deepEqual(segs, [
    { kind: 'text', text: 'Saved.' },
    { kind: 'canvas', json: body, complete: true },
  ]);
  assert.deepEqual(toolCallFor(segs[1]), { name: 'canvas_update', args: { op: 'create', title: 'Groceries', blocks: [] } });
  assert.deepEqual(decodeFence({ kind: 'canvas', json: '[1]', complete: true }), { ok: false, error: 'canvas update must be a JSON object' });
  assert.deepEqual(decodeFence({ kind: 'canvas', json: '{oops', complete: true }), { ok: false, error: 'invalid JSON' });
});

test('a partial ano-canvas opener is held back while streaming', () => {
  assert.deepEqual(parseSegments('Hi\n```ano-can'), [{ kind: 'text', text: 'Hi' }]);
  assert.deepEqual(parseSegments('Hi\n```ano-canvas\n{"op":"cre'), [
    { kind: 'text', text: 'Hi' },
    { kind: 'canvas', json: '{"op":"cre', complete: false },
  ]);
});
