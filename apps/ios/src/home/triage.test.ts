// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/home/triage.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HANDOFF_TTL_MS,
  doneUntil,
  isHidden,
  markSent,
  parseTriage,
  pruneTriage,
  snoozeUntil,
  unsentHandOffs,
  withoutEntries,
} from './triage.ts';

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m);
const handing = (since, extra = {}) => ({ state: 'handing', since, sent: false, title: 'Pay Hydro', agent: 'finance', prompt: 'Pay it', answer: null, ...extra });

test('a snooze lasts until 18:00 today, or 08:00 tomorrow once it is evening', () => {
  assert.equal(snoozeUntil(at(15, 9, 30)), at(15, 18).getTime());
  assert.equal(snoozeUntil(at(15, 2)), at(15, 18).getTime());
  assert.equal(snoozeUntil(at(15, 18)), at(16, 8).getTime());
  assert.equal(snoozeUntil(at(31, 23, 10)).valueOf(), new Date(2026, 10, 1, 8).getTime());
});

test('a card taken to chat stays away until the next 05:00', () => {
  assert.equal(doneUntil(at(15, 9)), at(16, 5).getTime());
  assert.equal(doneUntil(at(15, 3)), at(15, 5).getTime());
});

test('snoozed and done cards come back when their time is up; a hand-off stays hidden', () => {
  const until = at(15, 18).getTime();
  assert.equal(isHidden({ state: 'snoozed', until }, until - 1), true);
  assert.equal(isHidden({ state: 'snoozed', until }, until), false);
  assert.equal(isHidden({ state: 'done', until }, until + 1), false);
  assert.equal(isHidden(handing(0), until), true);
  assert.equal(isHidden(undefined, until), false);
});

test('stored state reads back and skips anything unreadable', () => {
  const state = { a: { state: 'snoozed', until: 5 }, b: handing(3, { sent: true }) };
  assert.deepEqual(parseTriage(JSON.stringify(state)), state);
  assert.deepEqual(parseTriage(JSON.stringify({ a: { state: 'snoozed' }, b: 'x', c: { state: 'done', until: 9 } })), { c: { state: 'done', until: 9 } });
  assert.deepEqual(parseTriage('not json'), {});
  assert.deepEqual(parseTriage(null), {});
  assert.deepEqual(parseTriage('[1]'), {});
});

test('pruning drops what ran out and hand-offs whose card was answered, and keeps the same object when nothing changed', () => {
  const now = at(15, 12).getTime();
  const state = {
    over: { state: 'snoozed', until: now - 1 },
    live: { state: 'snoozed', until: now + 1 },
    old: handing(now - HANDOFF_TTL_MS),
    gone: handing(now - 1000),
    waiting: handing(now - 1000),
  };
  assert.deepEqual(Object.keys(pruneTriage(state, now, new Set(['waiting', 'old']))), ['live', 'waiting']);
  assert.deepEqual(Object.keys(pruneTriage(state, now)), ['live', 'gone', 'waiting']);
  const clean = { live: state.live };
  assert.equal(pruneTriage(clean, now), clean);
});

test('unsent hand-offs come oldest first; marking them sent and removing entries leave the others', () => {
  const state = { b: handing(20), a: handing(10), s: { state: 'snoozed', until: 1 }, c: handing(30, { sent: true }) };
  assert.deepEqual(unsentHandOffs(state).map((u) => u.id), ['a', 'b']);
  const sent = markSent(state, ['a', 's']);
  assert.equal(sent.a.sent, true);
  assert.deepEqual(sent.s, state.s);
  assert.deepEqual(unsentHandOffs(sent).map((u) => u.id), ['b']);
  assert.deepEqual(Object.keys(withoutEntries(state, ['a', 'c'])), ['b', 's']);
  assert.equal(state.a.sent, false);
});
