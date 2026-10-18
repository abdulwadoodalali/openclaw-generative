// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/canvas/refresh.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { isStale } from './refresh.ts';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** Local time on the day of the tests (month is 0-based). */
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0).getTime();
const canvas = (refresh, lastRefreshedAt) => ({ agent: { refresh }, lastRefreshedAt });

test('manual is never stale', () => {
  assert.equal(isStale(canvas('manual', undefined), at(12, 12)), false);
  assert.equal(isStale(canvas('manual', 0), at(12, 12)), false);
});

test('open is stale unless refreshed within the last 2 minutes', () => {
  const now = at(12, 12);
  assert.equal(isStale(canvas('open', undefined), now), true);
  assert.equal(isStale(canvas('open', now - 119 * 1000), now), false);
  assert.equal(isStale(canvas('open', now - 2 * MIN), now), true);
  assert.equal(isStale(canvas('open', now - HOUR), now), true);
  assert.equal(isStale(canvas('open', now), now), false);
});

test('hourly is stale when older than one hour', () => {
  const now = at(12, 12);
  assert.equal(isStale(canvas('hourly', undefined), now), true);
  assert.equal(isStale(canvas('hourly', now - 59 * MIN), now), false);
  assert.equal(isStale(canvas('hourly', now - HOUR), now), false);
  assert.equal(isStale(canvas('hourly', now - HOUR - 1), now), true);
});

test('daily before 06:00 is never stale', () => {
  assert.equal(isStale(canvas('daily', undefined), at(12, 5, 59)), false);
  assert.equal(isStale(canvas('daily', at(10, 8)), at(12, 5, 59)), false);
});

test('daily is stale from 06:00 when the last refresh was before today 06:00', () => {
  assert.equal(isStale(canvas('daily', at(11, 23)), at(12, 6, 0)), true);
  assert.equal(isStale(canvas('daily', at(11, 23)), at(12, 14)), true);
  assert.equal(isStale(canvas('daily', undefined), at(12, 6, 0)), true);
  assert.equal(isStale(canvas('daily', at(12, 5, 59)), at(12, 6, 0)), true);
});

test('daily is fresh once refreshed after 06:00 today, including later that day', () => {
  assert.equal(isStale(canvas('daily', at(12, 6, 0)), at(12, 6, 0)), false);
  assert.equal(isStale(canvas('daily', at(12, 7)), at(12, 23, 59)), false);
});

test('daily across midnight: still fresh until 06:00 next day, then stale', () => {
  const refreshed = at(12, 7);
  assert.equal(isStale(canvas('daily', refreshed), at(13, 0, 30)), false);
  assert.equal(isStale(canvas('daily', refreshed), at(13, 5, 59)), false);
  assert.equal(isStale(canvas('daily', refreshed), at(13, 6, 0)), true);
  assert.equal(isStale(canvas('daily', at(12, 23, 50)), at(13, 6, 1)), true);
  assert.equal(isStale(canvas('daily', at(13, 6, 5)), at(13, 18)), false);
});
