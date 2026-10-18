// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILT_REST, stepTilt, tiltOffset } from './tilt.ts';

test('the first sample is the rest pose: no offset', () => {
  const f = stepTilt(TILT_REST, 0.6, -0.1);
  assert.deepEqual(tiltOffset(f, 3), { x: 0, y: 0 });
});

test('a tilt moves the highlight, clamped to the limit, then drifts back to centre', () => {
  let f = stepTilt(TILT_REST, 0.6, 0);
  for (let i = 0; i < 20; i++) f = stepTilt(f, 0.6, 1.2);
  const tilted = tiltOffset(f, 3);
  assert.equal(tilted.x, 3);
  assert.equal(tilted.y, 0);
  for (let i = 0; i < 600; i++) f = stepTilt(f, 0.6, 1.2);
  assert.ok(Math.abs(tiltOffset(f, 3).x) < 0.1);
});
