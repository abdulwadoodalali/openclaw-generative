// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/chat/turn.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawAgent } from '../openclaw/OpenClawAgent.ts';
import { ImageStore, toAttachments } from './images.ts';
import { imageOnlyPrompt, planRetry, startTurn, withBrain } from './turn.ts';

const KEY = 'agent:main:dashboard:t1';

const image = (name, extra = {}) => ({
  uri: `file:///${name}`,
  base64: `b64-${name}`,
  mimeType: 'image/jpeg',
  width: 640,
  height: 480,
  fileName: name,
  ...extra,
});

/** A gateway that answers every chat.send with a one-line reply. */
function fakeGateway() {
  const listeners = new Set();
  const calls = [];
  let runs = 0;
  const gateway = {
    async request(method, params = {}) {
      calls.push({ method, params });
      const runId = `r${(runs += 1)}`;
      setTimeout(() => {
        for (const l of [...listeners]) {
          l({ type: 'event', event: 'chat', payload: { runId, sessionKey: KEY, seq: 1, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: `reply ${runs}` }] } } });
        }
      }, 5);
      return { runId };
    },
    onEvent(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeStatus: () => () => undefined,
    getInfo: () => ({ status: 'ready', readyCount: 1 }),
  };
  return { gateway, calls };
}

test('images become chat.send image attachments', () => {
  assert.deepEqual(toAttachments([image('a.jpg'), image('b.png', { mimeType: 'image/png' })]), [
    { type: 'image', mimeType: 'image/jpeg', fileName: 'a.jpg', content: 'b64-a.jpg' },
    { type: 'image', mimeType: 'image/png', fileName: 'b.png', content: 'b64-b.png' },
  ]);
});

test('a turn with images sends them with chat.send and keeps them for the bubble', async () => {
  const { gateway, calls } = fakeGateway();
  const agent = new OpenClawAgent(gateway);
  agent.threadId = KEY;
  const store = new ImageStore();
  const images = [image('a.jpg')];
  startTurn(agent, store, { id: 'u1', text: 'what is this?', images });
  await agent.runAgent();
  assert.deepEqual(calls[0].params.attachments, toAttachments(images));
  assert.equal(calls[0].params.message, 'what is this?');
  assert.deepEqual(store.get('u1'), images);
  assert.deepEqual(store.get('other'), []);
});

test('retry re-sends the last user text with the images it had, as a new turn', async () => {
  const { gateway, calls } = fakeGateway();
  const agent = new OpenClawAgent(gateway);
  agent.threadId = KEY;
  const store = new ImageStore();
  const images = [image('a.jpg'), image('b.jpg')];
  startTurn(agent, store, { id: 'u1', text: 'compare these', images });
  await agent.runAgent();

  const plan = planRetry(agent.messages, store);
  assert.deepEqual(plan, { text: 'compare these', images });
  startTurn(agent, store, { id: 'u2', text: plan.text, images: plan.images });
  await agent.runAgent();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.message, 'compare these');
  assert.equal(calls[1].params.idempotencyKey, 'u2');
  assert.deepEqual(calls[1].params.attachments, toAttachments(images));
  // The retry is a new user turn after the first answer.
  assert.deepEqual(agent.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
});

test('retry picks the last user message and has nothing to re-send in an empty chat', () => {
  const store = new ImageStore();
  store.set('u2', [image('x.jpg')]);
  const messages = [
    { id: 'u1', role: 'user', content: 'first' },
    { id: 'a1', role: 'assistant', content: 'hello' },
    { id: 'u2', role: 'user', content: '  second  ' },
    { id: 'a2', role: 'assistant', content: 'hi' },
  ];
  assert.deepEqual(planRetry(messages, store), { text: 'second', images: [image('x.jpg')] });
  assert.equal(planRetry([{ id: 'a1', role: 'assistant', content: 'hello' }], store), null);
  assert.equal(planRetry([], store), null);
});

test('an image-only message gets a default question', () => {
  assert.equal(imageOnlyPrompt(1), 'What do you see in this image?');
  assert.equal(imageOnlyPrompt(3), 'What do you see in these images?');
});

test('the image store keeps the most recent messages only', () => {
  const store = new ImageStore();
  for (let i = 0; i < 30; i++) store.set(`u${i}`, [image(`${i}.jpg`)]);
  assert.deepEqual(store.get('u0'), []);
  assert.equal(store.get('u29').length, 1);
});

function brainRecorder(log) {
  return async (method, params) => {
    log.push(`${method}:${JSON.stringify(params)}`);
    return { ok: true };
  };
}

test('a one-off brain patches the chat, sends, then restores what the chat had (null resets)', async () => {
  const log = [];
  await withBrain(
    brainRecorder(log),
    KEY,
    { model: 'claude-cli/claude-sonnet-5-5', effort: 'max' },
    { model: null, effort: 'low' },
    async () => {
      log.push('chat.send');
    },
  );
  assert.deepEqual(log, [
    `sessions.patch:${JSON.stringify({ key: KEY, model: 'claude-cli/claude-sonnet-5-5' })}`,
    `sessions.patch:${JSON.stringify({ key: KEY, thinkingLevel: 'max' })}`,
    'chat.send',
    `sessions.patch:${JSON.stringify({ key: KEY, model: null })}`,
    `sessions.patch:${JSON.stringify({ key: KEY, thinkingLevel: 'low' })}`,
  ]);
});

test('the chat is restored after a failed run too, and the run error is the one reported', async () => {
  const log = [];
  await assert.rejects(
    withBrain(brainRecorder(log), KEY, { model: 'a/b', effort: null }, { model: 'x/y', effort: 'high' }, async () => {
      log.push('chat.send');
      throw new Error('run failed');
    }),
    /run failed/,
  );
  assert.deepEqual(log.slice(2), [
    'chat.send',
    `sessions.patch:${JSON.stringify({ key: KEY, model: 'x/y' })}`,
    `sessions.patch:${JSON.stringify({ key: KEY, thinkingLevel: 'high' })}`,
  ]);
});

test('a restore that fails is reported when the run itself was fine, and still tries both fields', async () => {
  const calls = [];
  const req = async (method, params) => {
    calls.push(params);
    if (calls.length === 3) throw new Error('model restore rejected');
    return {};
  };
  await assert.rejects(
    withBrain(req, KEY, { model: 'a/b', effort: 'low' }, { model: null, effort: null }, async () => undefined),
    /model restore rejected/,
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3], { key: KEY, thinkingLevel: null });
});

test('a patch that fails before the send stops the turn without running it', async () => {
  let ran = false;
  const req = async () => {
    throw new Error('patch rejected');
  };
  await assert.rejects(
    withBrain(req, KEY, { model: 'a/b', effort: null }, { model: null, effort: null }, async () => {
      ran = true;
    }),
    /patch rejected/,
  );
  assert.equal(ran, false);
});
