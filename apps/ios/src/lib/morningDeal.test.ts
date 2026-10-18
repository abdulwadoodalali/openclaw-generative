// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/lib/morningDeal.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { dealDay, shouldDeal } from './morningDeal.ts';

test('dealDay is the local calendar day, zero padded', () => {
  assert.equal(dealDay(new Date(2026, 9, 13, 8, 0)), '2026-10-13');
  assert.equal(dealDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the first open after 05:00 deals, later opens the same day do not', () => {
  assert.equal(shouldDeal(new Date(2026, 9, 13, 5, 0), null), true);
  assert.equal(shouldDeal(new Date(2026, 9, 13, 14, 0), '2026-10-12'), true);
  assert.equal(shouldDeal(new Date(2026, 9, 13, 14, 0), '2026-10-13'), false);
});

test('before 05:00 nothing is dealt and the day is not used up', () => {
  assert.equal(shouldDeal(new Date(2026, 9, 13, 4, 59), null), false);
  assert.equal(shouldDeal(new Date(2026, 9, 13, 0, 5), '2026-10-12'), false);
});
