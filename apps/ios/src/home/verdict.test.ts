// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/home/verdict.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClock, verdictLine } from './verdict.ts';

const none = { needs: 0, handled: 0, headsUp: 0, inProgress: 0, upcoming: null };

test('clock times print in 12 hour form', () => {
  assert.equal(formatClock(840), '2:00 pm');
  assert.equal(formatClock(545), '9:05 am');
  assert.equal(formatClock(0), '12:00 am');
  assert.equal(formatClock(750), '12:30 pm');
});

test('cards that need you lead, with the handled count when there is one', () => {
  assert.equal(verdictLine({ ...none, needs: 2, handled: 5 }), '2 things need you · 5 handled');
  assert.equal(verdictLine({ ...none, needs: 1 }), '1 thing needs you');
  assert.equal(verdictLine({ ...none, needs: 1, upcoming: [{ minutes: 840, title: 'x' }] }), '1 thing needs you');
});

test('with nothing to decide, the next event says how long the day is clear', () => {
  assert.equal(verdictLine({ ...none, handled: 3, upcoming: [{ minutes: 840, title: 'Dentist' }] }), 'Nothing needs you. Clear until 2:00 pm.');
  assert.equal(verdictLine({ ...none, upcoming: [] }), 'Nothing needs you. Clear for the rest of today.');
});

test('without a Today card it falls back to receipts, then to all quiet', () => {
  assert.equal(verdictLine({ ...none, handled: 4 }), 'Nothing needs you · 4 handled');
  assert.equal(verdictLine({ ...none, headsUp: 2 }), 'Nothing needs you.');
  assert.equal(verdictLine({ ...none, inProgress: 1 }), 'Nothing needs you.');
  assert.equal(verdictLine(none), "All quiet. I'll keep watch.");
});
