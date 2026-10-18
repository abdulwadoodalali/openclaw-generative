// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Canvas runner tests against an in-memory fake gateway and the real fence transformer.
// Run: node --experimental-strip-types --test src/canvas/runner.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFenceTransformer } from '../genui/fenceTransformer.ts';
import { CanvasRunners, LOCKED_ERROR } from './runner.ts';
import { CanvasStore } from './store.ts';

const block = (name, props = {}) => ({ component: name, props });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const fence = (body) => ['```ano-canvas', JSON.stringify(body), '```'].join('\n');

/** A gateway that creates sessions, accepts sessions.patch and answers every chat.send with `script.reply`. */
function makeEnv(opts = {}) {
  const listeners = new Set();
  const calls = [];
  const script = { reply: 'Done.', hang: false, patchFails: false };
  let runs = 0;
  let sessions = 0;
  const emit = (payload) => {
    for (const l of [...listeners]) l({ type: 'event', event: 'chat', payload });
  };
  const gateway = {
    async request(method, params = {}) {
      calls.push({ method, params });
      switch (method) {
        case 'sessions.create':
          sessions += 1;
          return { key: `agent:${params.agentId}:dashboard:s${sessions}` };
        case 'sessions.list':
          return { sessions: [] };
        case 'sessions.patch':
          if (script.patchFails) throw new Error('model not allowed');
          return { ok: true };
        case 'chat.abort':
          return {};
        case 'chat.send': {
          runs += 1;
          const runId = `run${runs}`;
          const sessionKey = params.sessionKey;
          if (!script.hang) {
            setTimeout(() => {
              emit({ runId, sessionKey, seq: 1, state: 'delta', deltaText: script.reply, message: { role: 'assistant', content: [{ type: 'text', text: script.reply }] } });
              emit({ runId, sessionKey, seq: 2, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: script.reply }] } });
            }, 5);
          }
          return { runId, status: 'started' };
        }
        default:
          throw new Error(`unhandled ${method}`);
      }
    },
    onEvent(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeStatus: () => () => undefined,
    getInfo: () => ({ status: 'ready', readyCount: 1 }),
  };
  let tickCount = 1000;
  let ids = 0;
  const store = new CanvasStore({ now: () => (tickCount += 10), newId: () => `id${(ids += 1)}` });
  const registry = new CanvasRunners();
  registry.init({
    gateway,
    getDefaultAgentId: () => opts.defaultAgentId ?? 'ano',
    createId: () => `msg${(ids += 1)}`,
    store,
    hooks: { createTransformer: (ctx) => createFenceTransformer(ctx) },
  });
  const sent = () => calls.filter((c) => c.method === 'chat.send');
  const patches = () => calls.filter((c) => c.method === 'sessions.patch').map((c) => c.params);
  return { registry, store, script, calls, sent, patches };
}

async function lockedCanvas(env, over = {}) {
  await env.store.ready;
  return env.store.create({
    title: 'Spend',
    blocks: [block('Stat', { label: 'Spend', value: '10' }), block('Note', { text: 'ok' })],
    by: 'ano',
    ...over,
  });
}

test('a refresh on a locked canvas accepts a value change, marks it refreshed and sends the refresh turn', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  assert.equal(canvas.locked, true);
  env.script.reply = `Refreshed.\n\n${fence({ summary: 'Refreshed: spend updated', blocks: [block('Stat', { label: 'Spend', value: '42' }), block('Note', { text: 'ok' })] })}`;
  const runner = env.registry.get(canvas.id);
  await runner.refresh();
  const state = runner.getState();
  assert.equal(state.error, null);
  assert.equal(state.running, false);
  assert.deepEqual(state.lastChange, { summary: 'Refreshed: spend updated', version: 2 });
  const updated = env.store.get(canvas.id);
  assert.equal(updated.blocks[0].props.value, '42');
  assert.ok(updated.lastRefreshedAt > 1000);
  const message = env.sent()[0].params.message;
  assert.match(message, /^<ano-canvas-context>/);
  assert.match(message, /Re-read every figure/);
  assert.match(message, /Refresh this canvas$/);
});

test('a refresh on a locked canvas rejects a structure change and changes nothing', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  env.script.reply = `Rebuilt.\n\n${fence({ summary: 'Rebuilt', blocks: [block('Card', { title: 'Spend' })] })}`;
  const runner = env.registry.get(canvas.id);
  await runner.refresh();
  const state = runner.getState();
  assert.match(state.error, /layout is locked/);
  assert.equal(state.lastChange, null);
  assert.equal(state.running, false);
  const current = env.store.get(canvas.id);
  assert.equal(current.version, 1);
  assert.equal(current.lastRefreshedAt, undefined);
  assert.deepEqual(current.blocks.map((b) => b.component), ['Stat', 'Note']);
});

test('a refresh on an unlocked canvas may change the structure', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env, { locked: false });
  env.script.reply = fence({ summary: 'Rebuilt', blocks: [block('Card', { title: 'Spend' })] });
  const runner = env.registry.get(canvas.id);
  await runner.refresh();
  assert.equal(runner.getState().error, null);
  assert.equal(env.store.get(canvas.id).version, 2);
  assert.ok(env.store.get(canvas.id).lastRefreshedAt);
});

test('a refresh without a canvas update shows what Ano said, without the prose markers, and is not marked refreshed', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  env.script.reply = 'I could not reach your vault.<!--ano:tc0-->';
  const runner = env.registry.get(canvas.id);
  await runner.refresh();
  assert.equal(runner.getState().error, 'I could not reach your vault.');
  assert.equal(env.store.get(canvas.id).lastRefreshedAt, undefined);
});

test('send and sendUiEvent refuse while locked and never reach the gateway', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  const runner = env.registry.get(canvas.id);
  await runner.send('make it blue');
  assert.equal(runner.getState().error, LOCKED_ERROR);
  assert.equal(LOCKED_ERROR, 'Unlock the canvas to change it');
  runner.clearError();
  assert.equal(runner.getState().error, null);
  await runner.sendUiEvent('[ui-event] tap');
  assert.equal(runner.getState().error, LOCKED_ERROR);
  assert.equal(env.sent().length, 0);
  assert.equal(env.store.get(canvas.id).version, 1);
});

test('send on an unlocked canvas edits it with the edit context and no refresh stamp', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env, { locked: false });
  env.script.reply = fence({ summary: 'Added a card', ops: [{ op: 'add', path: '/blocks/-', value: block('Card', { title: 'New' }) }], base: 1 });
  const runner = env.registry.get(canvas.id);
  await runner.send('add a card');
  assert.equal(runner.getState().error, null);
  assert.equal(env.store.get(canvas.id).blocks.length, 3);
  assert.equal(env.store.get(canvas.id).lastRefreshedAt, undefined);
  const message = env.sent()[0].params.message;
  assert.doesNotMatch(message, /Re-read every figure/);
  assert.match(message, /add a card$/);
});

test('an edit keeps the last exchange for the Customize sheet; refreshes and taps do not replace it', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env, { locked: false });
  const runner = env.registry.get(canvas.id);
  assert.equal(runner.getState().exchange, null);
  env.script.reply = fence({ summary: 'Added a card', ops: [{ op: 'add', path: '/blocks/-', value: block('Card', { title: 'New' }) }], base: 1 });
  await runner.send('add a card');
  assert.deepEqual(runner.getState().exchange, { request: 'add a card', reply: 'Added a card' });
  env.script.reply = 'Nothing new.';
  await runner.refresh();
  assert.deepEqual(runner.getState().exchange, { request: 'add a card', reply: 'Added a card' });
});

test('the session is created once under the canvas agent, in the Canvases project', async () => {
  const env = makeEnv({ defaultAgentId: 'ano-default' });
  const a = await lockedCanvas(env, { locked: false });
  const b = env.store.create({ title: 'Other', blocks: [], by: 'you', agent: { agentId: 'finance' } });
  env.script.reply = 'Nothing to change.';
  await env.registry.get(a.id).send('hi');
  await env.registry.get(a.id).send('again');
  await env.registry.get(b.id).send('hi');
  const creates = env.calls.filter((c) => c.method === 'sessions.create').map((c) => c.params);
  assert.equal(creates.length, 2);
  assert.equal(creates[0].agentId, 'ano-default');
  assert.equal(creates[0].category, 'Canvases');
  assert.equal(creates[0].label, 'Canvas: Spend');
  assert.equal(creates[1].agentId, 'finance');
  assert.match(env.store.get(a.id).sessionKey, /^agent:ano-default:/);
  assert.match(env.store.get(b.id).sessionKey, /^agent:finance:/);
  assert.equal(env.sent()[0].params.sessionKey, env.sent()[1].params.sessionKey);
});

test('a model change patches the session with the model, then with null to reset', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  env.script.reply = 'Nothing new.';
  const runner = env.registry.get(canvas.id);

  await runner.refresh();
  assert.deepEqual(env.patches(), [], 'a new session on the default model needs no patch');
  const key = env.store.get(canvas.id).sessionKey;

  env.store.setAgent(canvas.id, { model: 'opencode-go/kimi-k3' });
  await runner.refresh();
  assert.deepEqual(env.patches(), [{ key, model: 'opencode-go/kimi-k3' }]);

  await runner.refresh();
  assert.equal(env.patches().length, 1, 'an unchanged model is not patched again');

  env.store.setAgent(canvas.id, { model: null });
  await runner.refresh();
  assert.deepEqual(env.patches(), [{ key, model: 'opencode-go/kimi-k3' }, { key, model: null }]);
});

test('a new session on a non-default model is patched right after it is created', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env, { agent: { model: 'openrouter/google/gemini-3.8-flash' } });
  env.script.reply = 'Nothing new.';
  await env.registry.get(canvas.id).refresh();
  const key = env.store.get(canvas.id).sessionKey;
  assert.deepEqual(env.patches(), [{ key, model: 'openrouter/google/gemini-3.8-flash' }]);
  const order = env.calls.map((c) => c.method).filter((m) => ['sessions.create', 'sessions.patch', 'chat.send'].includes(m));
  assert.deepEqual(order, ['sessions.create', 'sessions.patch', 'chat.send']);
});

test('a runner that restarted re-applies the model to an existing session', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env, { agent: { model: null } });
  env.store.setSessionKey(canvas.id, 'agent:ano:dashboard:old');
  env.script.reply = 'Nothing new.';
  await env.registry.get(canvas.id).refresh();
  assert.deepEqual(env.patches(), [{ key: 'agent:ano:dashboard:old', model: null }]);
});

test('switching the canvas agentId starts a fresh session under the new agent', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  env.script.reply = 'Nothing new.';
  const runner = env.registry.get(canvas.id);
  await runner.refresh();
  const first = env.store.get(canvas.id).sessionKey;
  env.store.setAgent(canvas.id, { agentId: 'finance' });
  await runner.refresh();
  const second = env.store.get(canvas.id).sessionKey;
  assert.notEqual(first, second);
  assert.match(second, /^agent:finance:/);
});

test('a failing sessions.patch becomes the run error and the turn is not sent', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env, { agent: { model: 'opencode-go/kimi-k3' } });
  env.script.patchFails = true;
  const runner = env.registry.get(canvas.id);
  await runner.refresh();
  assert.match(runner.getState().error, /Could not switch to opencode-go\/kimi-k3: model not allowed/);
  assert.equal(env.sent().length, 0);
  assert.equal(runner.getState().running, false);
});

test('only one run per canvas at a time; other canvases run independently', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  const other = env.store.create({ title: 'Other', blocks: [block('Stat')], by: 'ano' });
  env.script.reply = 'Nothing new.';
  const runner = env.registry.get(canvas.id);
  const first = runner.refresh();
  assert.equal(runner.getState().running, true);
  assert.equal(runner.getState().kind, 'refresh');
  await runner.refresh();
  await runner.send('ignored');
  await Promise.all([first, env.registry.get(other.id).refresh()]);
  assert.equal(env.sent().length, 2);
  assert.equal(env.calls.filter((c) => c.method === 'sessions.create').length, 2);
});

test('state is a stable reference until it changes and subscribers hear about changes', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  env.script.reply = 'Nothing new.';
  const runner = env.registry.get(canvas.id);
  assert.equal(env.registry.get(canvas.id), runner);
  const before = runner.getState();
  assert.equal(runner.getState(), before);
  let heard = 0;
  const off = env.registry.subscribe(() => (heard += 1));
  await runner.refresh();
  assert.ok(heard >= 2);
  assert.notEqual(runner.getState(), before);
  off();
  const after = heard;
  runner.clearError();
  runner.clearError();
  assert.equal(heard, after);
});

test('stop aborts the run and applies nothing', async () => {
  const env = makeEnv();
  const canvas = await lockedCanvas(env);
  env.script.hang = true;
  const runner = env.registry.get(canvas.id);
  const run = runner.refresh();
  while (env.sent().length === 0) await tick();
  await tick();
  runner.stop();
  await run;
  await tick();
  const state = runner.getState();
  assert.equal(state.running, false);
  assert.equal(state.error, null);
  assert.equal(state.lastChange, null);
  assert.ok(env.calls.some((c) => c.method === 'chat.abort'));
  assert.equal(env.store.get(canvas.id).version, 1);
  assert.equal(env.store.get(canvas.id).lastRefreshedAt, undefined);
});

test('a missing canvas is reported, and runners without init report it too', async () => {
  const env = makeEnv();
  await env.store.ready;
  const runner = env.registry.get('nope');
  await runner.refresh();
  assert.equal(runner.getState().error, 'This canvas no longer exists');
  const uninitialized = new CanvasRunners().get('x');
  await uninitialized.refresh();
  assert.equal(uninitialized.getState().error, 'Canvases are not ready yet');
});
