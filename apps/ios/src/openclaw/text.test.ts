// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/openclaw/text.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { stripPersona } from './text.ts';

test('the persona marker is dropped at the start and at every later paragraph of a multi-step reply', () => {
  assert.equal(stripPersona('**Ano** Looking.\n\n**Ano** Done: added a card.\n\nDetails'), 'Looking.\n\nDone: added a card.\n\nDetails');
  assert.equal(stripPersona('Ano: sure'), 'sure');
});

test('the marker inside a sentence is kept, and a half-streamed marker renders empty', () => {
  assert.equal(stripPersona('Ask **Ano** anything'), 'Ask **Ano** anything');
  assert.equal(stripPersona('**An'), '');
});
