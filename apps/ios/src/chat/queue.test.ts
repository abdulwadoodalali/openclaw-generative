// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/chat/queue.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { SendQueue } from './queue.ts';

/** A queue whose turns stay "running" until the test finishes them. */
function setup() {
  const log = [];
  const pending = [];
  let ids = 0;
  let external = false;
  const deps = {
    isRunning: () => external || pending.length > 0,
    run: (turn) => {
      log.push(`run:${turn.text}`);
      return new Promise((resolve, reject) => pending.push({ turn, resolve, reject }));
    },
    steer: async (turn) => {
      log.push(`steer:${turn.text}`);
      if (deps.steerFails) throw new Error('No active run to steer');
    },
    onError: (e) => log.push(`error:${e.message}`),
    newId: () => `m${(ids += 1)}`,
    steerFails: false,
  };
  const queue = new SendQueue(deps);
  /** Ends the oldest running turn, then lets the queue continue. */
  const finish = async (error) => {
    const run = pending.shift();
    if (error) run.reject(new Error(error));
    else run.resolve();
    await tick();
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { queue, deps, log, finish, tick, setExternal: (v) => (external = v) };
}

const texts = (queue) => queue.getState().items.map((t) => t.text);

test('an idle send runs right away, a send while a run is active is queued', async () => {
  const { queue, log, finish, tick } = setup();
  const first = queue.send('one');
  await tick();
  assert.deepEqual(log, ['run:one']);
  await queue.send('two');
  await queue.send('three');
  assert.deepEqual(log, ['run:one']);
  assert.deepEqual(texts(queue), ['two', 'three']);
  await finish();
  await finish();
  await finish();
  await first;
});

test('queued messages are sent in order, one turn each, when the run ends well', async () => {
  const { queue, log, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  await queue.send('three');
  await finish();
  assert.deepEqual(log, ['run:one', 'run:two']);
  assert.deepEqual(texts(queue), ['three']);
  await finish();
  assert.deepEqual(log, ['run:one', 'run:two', 'run:three']);
  assert.deepEqual(texts(queue), []);
  await finish();
  await done;
  assert.equal(queue.getState().paused, false);
});

test('a failed run pauses the queue and keeps the waiting messages', async () => {
  const { queue, log, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  await finish('offline');
  await done;
  assert.deepEqual(log, ['run:one', 'error:offline']);
  assert.deepEqual(texts(queue), ['two']);
  assert.equal(queue.getState().paused, true);
  await tick();
  assert.deepEqual(log, ['run:one', 'error:offline'], 'nothing is sent while paused');
});

test('resume sends the kept messages in order; a new send while paused joins the end and goes on', async () => {
  const { queue, log, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  await finish('offline');
  await done;

  const resumed = queue.send('three'); // typed while paused: sending means "go on"
  await tick();
  assert.deepEqual(log.slice(2), ['run:two']);
  assert.deepEqual(texts(queue), ['three']);
  assert.equal(queue.getState().paused, false);
  await finish();
  await finish();
  await resumed;
  assert.deepEqual(log.slice(2), ['run:two', 'run:three']);

  // resumeQueue() alone does the same for a paused queue.
  const again = queue.send('four');
  await tick();
  await queue.send('five');
  await finish('boom');
  await again;
  assert.equal(queue.getState().paused, true);
  const r = queue.resume();
  await tick();
  assert.equal(log[log.length - 1], 'run:five');
  await finish();
  await r;
});

test('after a failure with nothing waiting the next send is a normal send', async () => {
  const { queue, log, finish, tick } = setup();
  const failed = queue.send('one');
  await tick();
  await finish('offline');
  await failed;
  assert.equal(queue.getState().paused, false);
  const next = queue.send('two');
  await tick();
  assert.deepEqual(log, ['run:one', 'error:offline', 'run:two']);
  await finish();
  await next;
});

test('stop pauses first: the run ending does not send the next message', async () => {
  const { queue, log, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  queue.pause();
  assert.equal(queue.getState().paused, true);
  await finish();
  await done;
  assert.deepEqual(log, ['run:one']);
  assert.deepEqual(texts(queue), ['two']);
});

test('sendNow steers the running reply with the queued message and removes it', async () => {
  const { queue, log, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  await queue.send('three');
  const [two] = queue.getState().items;
  await queue.sendNow(two.id);
  assert.deepEqual(log, ['run:one', 'steer:two']);
  assert.deepEqual(texts(queue), ['three']);
  await finish();
  await finish();
  await done;
  assert.deepEqual(log, ['run:one', 'steer:two', 'run:three']);
});

test('a steer that fails keeps the message in the queue, in place, and reports the error', async () => {
  const { queue, deps, log, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  await queue.send('three');
  deps.steerFails = true;
  await queue.sendNow(queue.getState().items[1].id);
  assert.deepEqual(log, ['run:one', 'steer:three', 'error:No active run to steer']);
  assert.deepEqual(texts(queue), ['two', 'three']);
  deps.steerFails = false;
  await finish();
  await finish();
  await finish();
  await done;
});

test('dequeue returns the message so its text can go back into the field', async () => {
  const { queue, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two', [{ uri: 'file:///a', base64: 'x', mimeType: 'image/jpeg', width: 1, height: 1, fileName: 'a.jpg' }]);
  const [item] = queue.getState().items;
  const removed = queue.dequeue(item.id);
  assert.equal(removed.text, 'two');
  assert.equal(removed.images.length, 1);
  assert.deepEqual(texts(queue), []);
  assert.equal(queue.dequeue('missing'), undefined);
  await finish();
  await done;
});

test('a run this queue did not start (an interaction, an adopted run) is followed by a flush', async () => {
  const { queue, log, finish, tick, setExternal } = setup();
  setExternal(true);
  await queue.send('one'); // a run is active that the queue did not start: queued
  assert.deepEqual(log, []);
  assert.deepEqual(texts(queue), ['one']);
  await queue.flush();
  assert.deepEqual(log, [], 'still running');
  setExternal(false);
  const flushed = queue.flush();
  await tick();
  assert.deepEqual(log, ['run:one']);
  await finish();
  await flushed;
});

test('reset empties the queue when the chat changes', async () => {
  const { queue, finish, tick } = setup();
  const done = queue.send('one');
  await tick();
  await queue.send('two');
  queue.pause();
  queue.reset();
  assert.deepEqual(queue.getState(), { items: [], paused: false });
  await finish();
  await done;
});

test('subscribers hear every change and the state object is stable between changes', async () => {
  const { queue, finish, tick } = setup();
  let heard = 0;
  const off = queue.subscribe(() => (heard += 1));
  const done = queue.send('one');
  await tick();
  const before = queue.getState();
  assert.equal(queue.getState(), before);
  await queue.send('two');
  assert.notEqual(queue.getState(), before);
  assert.ok(heard >= 1);
  off();
  await finish();
  await finish();
  await done;
});

test('a queued message keeps its own one-off brain, the others have none', async () => {
  const { queue, log, finish, tick } = setup();
  const seen = [];
  const done = queue.send('one');
  await tick();
  await queue.send('two', [], { model: 'a/b', effort: 'max' });
  await queue.send('three');
  assert.deepEqual(queue.getState().items.map((t) => t.once), [{ model: 'a/b', effort: 'max' }, undefined]);
  await finish();
  assert.equal(log[log.length - 1], 'run:two');
  await finish();
  await finish();
  await done;
});
