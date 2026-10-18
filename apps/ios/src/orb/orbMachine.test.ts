// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DONE_HOLD_MS,
  INITIAL_ORB,
  KEYSTROKE_THROTTLE_MS,
  QUIET_AFTER_MS,
  RELAX_AFTER_MS,
  SLOW_AFTER_MS,
  hapticFor,
  nextDeadline,
  reduceOrb,
} from './orbMachine.ts';

/** Feed [event, at] pairs from the initial state; returns every intermediate state. */
function run(steps) {
  const states = [];
  let s = INITIAL_ORB;
  for (const [event, at] of steps) {
    s = reduceOrb(s, event, at);
    states.push(s);
  }
  return states;
}
const last = (steps) => run(steps).at(-1);
const online = [{ type: 'connection', online: true }, 0];

test('starts offline and goes idle on connect, with a reconnect pulse', () => {
  assert.equal(INITIAL_ORB.visual, 'offline');
  const s = last([online]);
  assert.equal(s.visual, 'idle');
  assert.equal(s.pulse, 'reconnect');
});

test('a chat run walks thinking, working, streaming, done, then idle', () => {
  const states = run([
    online,
    [{ type: 'run', mode: 'waiting' }, 100],
    [{ type: 'run', mode: 'thinking' }, 200],
    [{ type: 'toolStart' }, 300],
    [{ type: 'toolEnd' }, 900],
    [{ type: 'token' }, 1000],
    [{ type: 'done', ms: 1200 }, 1300],
    [{ type: 'tick' }, 1300 + DONE_HOLD_MS],
  ]);
  assert.deepEqual(
    states.map((s) => s.visual),
    ['idle', 'thinking', 'thinking', 'working', 'working', 'streaming', 'done', 'idle'],
  );
  assert.equal(states[3].tools, 1);
  assert.equal(states[4].tools, 0);
});

test('tool starts and handoffs ring; the handoff tone sticks for the run', () => {
  const s = last([online, [{ type: 'run', mode: 'thinking' }, 0], [{ type: 'handoff', tone: 'household' }, 10]]);
  assert.equal(s.visual, 'working');
  assert.equal(s.pulse, 'ring');
  assert.equal(s.tone, 'household');
  const after = reduceOrb(s, { type: 'done', ms: 50 }, 60);
  assert.equal(after.tone, null);
});

test('tokens and tools without a run do nothing', () => {
  const s = last([online, [{ type: 'token' }, 0], [{ type: 'toolStart' }, 5]]);
  assert.equal(s.visual, 'idle');
  assert.equal(s.tools, 0);
});

test('offline beats everything, and the run shows again on reconnect', () => {
  const s = last([online, [{ type: 'run', mode: 'thinking' }, 0], [{ type: 'connection', online: false }, 10]]);
  assert.equal(s.visual, 'offline');
  assert.equal(reduceOrb(s, { type: 'error' }, 20).visual, 'offline');
  assert.equal(reduceOrb(s, { type: 'focus' }, 20).visual, 'offline');
  assert.equal(reduceOrb(s, { type: 'connection', online: true }, 20).visual, 'thinking');
});

test('error holds through time and focus loss until the next user action', () => {
  const failed = last([online, [{ type: 'run', mode: 'thinking' }, 0], [{ type: 'error' }, 100]]);
  assert.equal(failed.visual, 'error');
  assert.equal(nextDeadline(failed), null);
  assert.equal(reduceOrb(failed, { type: 'tick' }, 60_000).visual, 'error');
  assert.equal(reduceOrb(failed, { type: 'blur' }, 200).visual, 'error');
  assert.equal(reduceOrb(failed, { type: 'focus' }, 200).visual, 'listening');
  assert.equal(reduceOrb(failed, { type: 'keystroke' }, 200).visual, 'listening');
  assert.equal(reduceOrb(failed, { type: 'send' }, 200).visual, 'idle');
  assert.equal(reduceOrb(failed, { type: 'run', mode: 'waiting' }, 200).visual, 'thinking');
});

test('a run beats listening; done beats listening, then listening returns', () => {
  const typing = last([online, [{ type: 'focus' }, 0]]);
  assert.equal(typing.visual, 'listening');
  const thinking = reduceOrb(typing, { type: 'run', mode: 'waiting' }, 10);
  assert.equal(thinking.visual, 'thinking');
  const done = reduceOrb(thinking, { type: 'done', ms: 10 }, 20);
  assert.equal(done.visual, 'done');
  assert.equal(nextDeadline(done), 20 + DONE_HOLD_MS);
  assert.equal(reduceOrb(done, { type: 'tick' }, 20 + DONE_HOLD_MS - 1).visual, 'done');
  assert.equal(reduceOrb(done, { type: 'tick' }, 20 + DONE_HOLD_MS).visual, 'listening');
});

test('a run that ends without an outcome goes straight back', () => {
  const s = last([online, [{ type: 'run', mode: 'answering' }, 0], [{ type: 'run', mode: null }, 10]]);
  assert.equal(s.visual, 'idle');
  assert.equal(s.doneAt, null);
});

test('listening relaxes after quiet typing; a keystroke tenses it again', () => {
  const focused = last([online, [{ type: 'focus' }, 0]]);
  assert.equal(nextDeadline(focused), RELAX_AFTER_MS);
  const relaxed = reduceOrb(focused, { type: 'tick' }, RELAX_AFTER_MS);
  assert.equal(relaxed.relaxed, true);
  assert.equal(nextDeadline(relaxed), null);
  const typed = reduceOrb(relaxed, { type: 'keystroke' }, RELAX_AFTER_MS + 5);
  assert.equal(typed.relaxed, false);
  assert.equal(nextDeadline(typed), 2 * RELAX_AFTER_MS + 5);
});

test('keystroke pulses are throttled; typing still counts', () => {
  const states = run([
    online,
    [{ type: 'keystroke' }, 1000],
    [{ type: 'keystroke' }, 1000 + KEYSTROKE_THROTTLE_MS - 1],
    [{ type: 'keystroke' }, 1000 + KEYSTROKE_THROTTLE_MS],
  ]);
  assert.deepEqual(
    states.slice(1).map((s) => s.pulseSeq - states[0].pulseSeq),
    [1, 1, 2],
  );
  assert.equal(states[2].typedAt, 1000 + KEYSTROKE_THROTTLE_MS - 1);
});

test('thinking slows after 10 s of the run, working too', () => {
  const s = last([online, [{ type: 'run', mode: 'thinking' }, 500]]);
  assert.equal(s.slow, false);
  assert.equal(nextDeadline(s), 500 + SLOW_AFTER_MS);
  assert.equal(reduceOrb(s, { type: 'tick' }, 500 + SLOW_AFTER_MS).slow, true);
  const working = reduceOrb(s, { type: 'toolStart' }, 600);
  assert.equal(reduceOrb(working, { type: 'tick' }, 500 + SLOW_AFTER_MS).slow, true);
});

test('streaming goes quiet without tokens and wakes on the next one', () => {
  const s = last([online, [{ type: 'run', mode: 'thinking' }, 0], [{ type: 'token' }, 100]]);
  assert.equal(nextDeadline(s), 100 + QUIET_AFTER_MS);
  const quiet = reduceOrb(s, { type: 'tick' }, 100 + QUIET_AFTER_MS);
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.slow, false);
  assert.equal(reduceOrb(quiet, { type: 'token' }, 2000).quiet, false);
});

test('haptics: warning on error, soft on done only after a long run', () => {
  const thinking = last([online, [{ type: 'run', mode: 'thinking' }, 0]]);
  assert.equal(hapticFor(thinking, reduceOrb(thinking, { type: 'error' }, 10)), 'warning');
  assert.equal(hapticFor(thinking, reduceOrb(thinking, { type: 'done', ms: 7999 }, 10)), null);
  assert.equal(hapticFor(thinking, reduceOrb(thinking, { type: 'done', ms: 8000 }, 10)), 'soft');
  const failed = reduceOrb(thinking, { type: 'error' }, 10);
  assert.equal(hapticFor(failed, reduceOrb(failed, { type: 'error' }, 20)), null);
});
