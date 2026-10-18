// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/canvas/store.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_CANVAS_ID } from './protocol.ts';
import { CanvasStore } from './store.ts';

const block = (name, props = {}) => ({ component: name, props });

function memoryStorage(initial = null) {
  const storage = {
    data: initial,
    saves: 0,
    failing: false,
    async load() {
      return storage.data;
    },
    async save(json) {
      storage.saves += 1;
      if (storage.failing) throw new Error('disk full');
      storage.data = json;
    },
  };
  return storage;
}

function makeStore(storage = undefined) {
  let tick = 1000;
  let n = 0;
  return new CanvasStore({ storage, now: () => (tick += 10), newId: () => `id${(n += 1)}` });
}

async function readyStore(storage = undefined) {
  const store = makeStore(storage);
  await store.ready;
  return store;
}

test('home canvas is ensured after load', async () => {
  const store = await readyStore();
  const home = store.get(HOME_CANVAS_ID);
  assert.ok(home);
  assert.equal(home.kind, 'home');
  assert.equal(home.title, 'Home');
  assert.deepEqual(home.blocks, []);
  assert.equal(home.version, 1);
  assert.equal(store.getSnapshot().length, 1);
});

test('create makes version 1 with a history entry', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'Berlin', blocks: [block('Card')], by: 'ano', summary: 'Built it' });
  assert.equal(canvas.id, 'id1');
  assert.equal(canvas.version, 1);
  assert.equal(canvas.scope, 'private');
  assert.equal(canvas.pinned, false);
  assert.equal(canvas.kind, 'user');
  assert.equal(canvas.summary, 'Built it');
  assert.equal(canvas.updatedBy, 'ano');
  assert.equal(canvas.history.length, 1);
  assert.deepEqual(canvas.history[0], { version: 1, title: 'Berlin', blocks: [block('Card')], at: canvas.updatedAt, by: 'ano', summary: 'Built it' });
  assert.equal(store.get('id1'), canvas);
});

test('create honours id, scope and pinned, and returns the existing canvas for a taken id', async () => {
  const store = await readyStore();
  const a = store.create({ id: 'mine', title: 'A', blocks: [], by: 'you', scope: 'household', pinned: true });
  assert.equal(a.id, 'mine');
  assert.equal(a.scope, 'household');
  assert.equal(a.pinned, true);
  const again = store.create({ id: 'mine', title: 'B', blocks: [], by: 'you' });
  assert.equal(again, a);
  assert.equal(store.getSnapshot().length, 2);
});

test('update by blocks bumps the version and history', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [block('Card')], by: 'you' });
  const result = store.applyUpdate('id1', { summary: 'Swapped the card', blocks: [block('Stat')] }, 'ano');
  assert.ok(result.ok);
  assert.equal(result.canvas.version, 2);
  assert.equal(result.canvas.summary, 'Swapped the card');
  assert.equal(result.canvas.updatedBy, 'ano');
  assert.deepEqual(result.canvas.blocks, [block('Stat')]);
  assert.deepEqual(result.canvas.history.map((v) => v.version), [1, 2]);
  assert.deepEqual(result.canvas.history[0].blocks, [block('Card')]);
  assert.equal(store.get('id1'), result.canvas);
});

test('update by ops bumps the version and a title in the update renames', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [block('Card', { title: 'a' })], by: 'you' });
  const result = store.applyUpdate(
    'id1',
    { summary: 'Retitled card', title: 'T2', base: 1, ops: [{ op: 'replace', path: '/blocks/0/props/title', value: 'b' }] },
    'ano',
  );
  assert.ok(result.ok);
  assert.equal(result.canvas.version, 2);
  assert.equal(result.canvas.title, 'T2');
  assert.equal(result.canvas.blocks[0].props.title, 'b');
  assert.equal(result.canvas.history.length, 2);
  assert.equal(result.canvas.history[1].title, 'T2');
});

test('a patch with a stale base still applies when it applies cleanly, and fails with a version error otherwise', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [block('Card'), block('Stat')], by: 'you' });
  store.applyUpdate('id1', { blocks: [block('Card'), block('Stat'), block('Note')] }, 'you');
  const clean = store.applyUpdate('id1', { base: 1, ops: [{ op: 'remove', path: '/blocks/0' }] }, 'ano');
  assert.ok(clean.ok);
  assert.equal(clean.canvas.version, 3);
  const stale = store.applyUpdate('id1', { base: 1, ops: [{ op: 'remove', path: '/blocks/5' }] }, 'ano');
  assert.equal(stale.ok, false);
  assert.match(stale.error, /^canvas changed since version 1/);
  assert.equal(store.get('id1').version, 3);
});

test('failed updates change nothing', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [block('Card')], by: 'you' });
  const before = store.getSnapshot();
  const missing = store.applyUpdate('nope', { blocks: [] }, 'ano');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);
  const bad = store.applyUpdate('id1', { blocks: [{ component: 'no good', props: {} }] }, 'ano');
  assert.equal(bad.ok, false);
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.get('id1').version, 1);
});

test('scope and pin updates do not create a version', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [], by: 'you' });
  const result = store.applyUpdate('id1', { scope: 'household', pin: true }, 'ano');
  assert.ok(result.ok);
  assert.equal(result.canvas.version, 1);
  assert.equal(result.canvas.scope, 'household');
  assert.equal(result.canvas.pinned, true);
  assert.equal(result.canvas.history.length, 1);
});

test('undo restores the previous version as a new version', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [block('Card')], by: 'you' });
  store.applyUpdate('id1', { summary: 'Added a stat', blocks: [block('Card'), block('Stat')] }, 'ano');
  const undone = store.undo('id1');
  assert.ok(undone);
  assert.equal(undone.version, 3);
  assert.deepEqual(undone.blocks, [block('Card')]);
  assert.equal(undone.summary, 'Undid: Added a stat');
  assert.equal(undone.updatedBy, 'you');
  assert.deepEqual(undone.history.map((v) => v.version), [1, 2, 3]);
  assert.deepEqual(undone.history[1].blocks, [block('Card'), block('Stat')]);
  assert.equal(store.get('id1'), undone);
});

test('undo with a single version does nothing', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [], by: 'you' });
  const before = store.getSnapshot();
  assert.equal(store.undo('id1'), undefined);
  assert.equal(store.undo('missing'), undefined);
  assert.equal(store.getSnapshot(), before);
});

test('restore brings back any kept version as a new version', async () => {
  const store = await readyStore();
  store.create({ title: 'One', blocks: [block('Card')], by: 'you' });
  store.applyUpdate('id1', { title: 'Two', blocks: [block('Stat')] }, 'ano');
  store.applyUpdate('id1', { title: 'Three', blocks: [block('Note')] }, 'ano');
  const restored = store.restore('id1', 1);
  assert.ok(restored);
  assert.equal(restored.version, 4);
  assert.equal(restored.title, 'One');
  assert.deepEqual(restored.blocks, [block('Card')]);
  assert.equal(restored.summary, 'Restored version 1');
  assert.equal(store.restore('id1', 99), undefined);
  assert.equal(store.restore('id1', 4), restored);
});

test('history is capped at 30 versions and keeps the newest', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [block('Card', { n: 0 })], by: 'you' });
  for (let i = 1; i <= 40; i += 1) store.applyUpdate('id1', { blocks: [block('Card', { n: i })] }, 'ano');
  const canvas = store.get('id1');
  assert.equal(canvas.version, 41);
  assert.equal(canvas.history.length, 30);
  assert.equal(canvas.history[0].version, 12);
  assert.equal(canvas.history[29].version, 41);
  assert.equal(store.restore('id1', 1), undefined);
  assert.equal(store.undo('id1').blocks[0].props.n, 39);
});

test('pin, scope, rename, session key and remove', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [], by: 'you' });
  store.setPinned('id1', true);
  store.setScope('id1', 'household');
  store.setSessionKey('id1', 'agent:ano:canvas1');
  let canvas = store.get('id1');
  assert.equal(canvas.pinned, true);
  assert.equal(canvas.scope, 'household');
  assert.equal(canvas.sessionKey, 'agent:ano:canvas1');
  assert.equal(canvas.version, 1);
  store.rename('id1', '  Berlin plan  ');
  canvas = store.get('id1');
  assert.equal(canvas.title, 'Berlin plan');
  assert.equal(canvas.version, 2);
  assert.equal(canvas.history[1].title, 'Berlin plan');
  store.remove('id1');
  assert.equal(store.get('id1'), undefined);
  store.remove(HOME_CANVAS_ID);
  assert.ok(store.get(HOME_CANVAS_ID));
});

test('setters that change nothing do not notify', async () => {
  const store = await readyStore();
  store.create({ title: 'T', blocks: [], by: 'you' });
  let calls = 0;
  store.subscribe(() => (calls += 1));
  store.setPinned('id1', false);
  store.setScope('id1', 'private');
  store.rename('id1', 'T');
  store.setPinned('missing', true);
  assert.equal(calls, 0);
});

test('getSnapshot is stable until something changes, then a new array', async () => {
  const store = await readyStore();
  const first = store.getSnapshot();
  assert.equal(store.getSnapshot(), first);
  store.create({ title: 'T', blocks: [], by: 'you' });
  const second = store.getSnapshot();
  assert.notEqual(second, first);
  assert.equal(store.getSnapshot(), second);
  store.setPinned('id1', true);
  assert.notEqual(store.getSnapshot(), second);
});

test('subscribe notifies on change and stops after unsubscribe', async () => {
  const store = await readyStore();
  let calls = 0;
  const off = store.subscribe(() => (calls += 1));
  store.create({ title: 'T', blocks: [], by: 'you' });
  store.applyUpdate('id1', { blocks: [block('Card')] }, 'ano');
  assert.equal(calls, 2);
  off();
  store.undo('id1');
  assert.equal(calls, 2);
});

test('persistence round trip through storage', async () => {
  const storage = memoryStorage();
  const store = await readyStore(storage);
  store.create({ title: 'Berlin', blocks: [block('Card')], by: 'you', pinned: true, scope: 'household' });
  store.applyUpdate('id1', { summary: 'Added stat', blocks: [block('Card'), block('Stat')] }, 'ano');
  store.setSessionKey('id1', 'agent:ano:abc');
  await store.flush();

  const reopened = await readyStore(storage);
  assert.deepEqual(reopened.getSnapshot(), store.getSnapshot());
  const canvas = reopened.get('id1');
  assert.equal(canvas.version, 2);
  assert.equal(canvas.pinned, true);
  assert.equal(canvas.sessionKey, 'agent:ano:abc');
  assert.equal(canvas.history.length, 2);
  assert.ok(reopened.get(HOME_CANVAS_ID));
});

test('every change is saved, in order, and the last save wins', async () => {
  const storage = memoryStorage();
  const store = await readyStore(storage);
  store.create({ title: 'A', blocks: [], by: 'you' });
  store.rename('id1', 'B');
  store.rename('id1', 'C');
  await store.flush();
  const saved = JSON.parse(storage.data);
  assert.equal(saved.canvases.find((c) => c.id === 'id1').title, 'C');
});

test('a failing save does not break the store or later saves', async () => {
  const storage = memoryStorage();
  const store = await readyStore(storage);
  storage.failing = true;
  store.create({ title: 'A', blocks: [], by: 'you' });
  await store.flush();
  assert.equal(store.get('id1').title, 'A');
  storage.failing = false;
  store.rename('id1', 'B');
  await store.flush();
  assert.equal(JSON.parse(storage.data).canvases.find((c) => c.id === 'id1').title, 'B');
});

test('garbage or unreadable storage starts empty with the home canvas', async () => {
  for (const data of ['not json', '{"canvases":"x"}', '[]', '{"canvases":[{"id":1},null,{"id":"x"}]}']) {
    const store = await readyStore(memoryStorage(data));
    assert.deepEqual(store.getSnapshot().map((c) => c.id), [HOME_CANVAS_ID], data);
  }
  const broken = { async load() { throw new Error('boom'); }, async save() {} };
  const store = await readyStore(broken);
  assert.deepEqual(store.getSnapshot().map((c) => c.id), [HOME_CANVAS_ID]);
});

test('a stored home canvas is kept as is, not replaced', async () => {
  const storage = memoryStorage();
  const first = await readyStore(storage);
  first.applyUpdate(HOME_CANVAS_ID, { summary: 'Planned', blocks: [block('TaskList', { items: ['x'] })] }, 'ano');
  await first.flush();
  const second = await readyStore(storage);
  assert.equal(second.get(HOME_CANVAS_ID).version, 2);
  assert.equal(second.getSnapshot().filter((c) => c.kind === 'home').length, 1);
});

test('canvases created before storage finished loading survive the load', async () => {
  const storage = memoryStorage();
  const seed = await readyStore(storage);
  seed.create({ title: 'Stored', blocks: [], by: 'you' });
  await seed.flush();

  const store = makeStore(storage);
  const early = store.create({ id: 'early', title: 'Early', blocks: [], by: 'you' });
  await store.ready;
  assert.equal(store.get('early'), early);
  assert.ok(store.get('id1'));
  assert.ok(store.get(HOME_CANVAS_ID));
});

// ---- v2: lock, agent, append, refresh, migration -------------------------------------------------

test('create defaults: locked when it starts with blocks, unlocked when empty or home; agent defaults', async () => {
  const store = await readyStore();
  const full = store.create({ title: 'Pinned', blocks: [block('Card')], by: 'ano' });
  assert.equal(full.locked, true);
  assert.deepEqual(full.agent, { name: null, instructions: '', model: null, modelName: null, agentId: null, refresh: 'manual' });
  assert.equal(full.origin, undefined);
  assert.equal(full.lastRefreshedAt, undefined);
  assert.equal(store.create({ title: 'Empty', blocks: [], by: 'you' }).locked, false);
  const home = store.get(HOME_CANVAS_ID);
  assert.equal(home.locked, false);
  assert.equal(home.agent.refresh, 'daily');
});

test('create takes locked, origin and a partial agent', async () => {
  const store = await readyStore();
  const canvas = store.create({
    title: 'Food',
    blocks: [block('Card')],
    by: 'ano',
    locked: false,
    origin: { prompt: 'How much on food?', sessionKey: 'agent:ano:chat1', at: 5 },
    agent: { name: 'Budget buddy', instructions: 'Track spend', model: 'opencode-go/kimi-k3', refresh: 'hourly' },
  });
  assert.equal(canvas.locked, false);
  assert.deepEqual(canvas.origin, { prompt: 'How much on food?', sessionKey: 'agent:ano:chat1', at: 5 });
  assert.deepEqual(canvas.agent, { name: 'Budget buddy', instructions: 'Track spend', model: 'opencode-go/kimi-k3', modelName: null, agentId: null, refresh: 'hourly' });
});

test('setLocked changes the flag without a new version', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Card')], by: 'ano' });
  let notified = 0;
  store.subscribe(() => (notified += 1));
  store.setLocked(canvas.id, false);
  assert.equal(store.get(canvas.id).locked, false);
  assert.equal(store.get(canvas.id).version, 1);
  assert.equal(notified, 1);
  store.setLocked(canvas.id, false);
  assert.equal(notified, 1);
  store.setLocked('missing', true);
});

test('setAgent patches the agent without a new version and clamps values', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Card')], by: 'ano' });
  store.setAgent(canvas.id, { name: '  Budget buddy  ', instructions: 'x'.repeat(2500), model: 'opencode-go/kimi-k3', refresh: 'daily' });
  const agent = store.get(canvas.id).agent;
  assert.equal(agent.name, 'Budget buddy');
  assert.equal(agent.instructions.length, 2000);
  assert.equal(agent.model, 'opencode-go/kimi-k3');
  assert.equal(agent.refresh, 'daily');
  assert.equal(store.get(canvas.id).version, 1);
  store.setAgent(canvas.id, { name: null, model: null });
  assert.equal(store.get(canvas.id).agent.name, null);
  assert.equal(store.get(canvas.id).agent.model, null);
  store.setAgent(canvas.id, { refresh: 'sometimes' });
  assert.equal(store.get(canvas.id).agent.refresh, 'daily');
});

test('a model display name follows its model and survives a reload', async () => {
  const storage = memoryStorage();
  const store = await readyStore(storage);
  const canvas = store.create({ title: 'A', blocks: [block('Card')], by: 'ano' });
  store.setAgent(canvas.id, { model: 'opencode-go/kimi-k3', modelName: 'Kimi K3' });
  assert.equal(store.get(canvas.id).agent.modelName, 'Kimi K3');
  // Another model without a name must not keep showing the old name.
  store.setAgent(canvas.id, { model: 'openrouter/google/gemini-3.8-flash' });
  assert.equal(store.get(canvas.id).agent.modelName, null);
  store.setAgent(canvas.id, { model: 'openrouter/google/gemini-3.8-flash', modelName: 'Gemini 3.8 Flash' });
  await store.flush();
  const reloaded = await readyStore(storage);
  assert.equal(reloaded.get(canvas.id).agent.modelName, 'Gemini 3.8 Flash');
  // Back to the default: no name either.
  reloaded.setAgent(canvas.id, { model: null, modelName: 'stale' });
  assert.equal(reloaded.get(canvas.id).agent.modelName, null);
});

test('changing the agentId clears the session key, other agent changes keep it', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Card')], by: 'ano' });
  store.setSessionKey(canvas.id, 'agent:ano:canvas1');
  store.setAgent(canvas.id, { model: 'opencode-go/kimi-k3', name: 'Helper' });
  assert.equal(store.get(canvas.id).sessionKey, 'agent:ano:canvas1');
  store.setAgent(canvas.id, { agentId: 'finance' });
  assert.equal(store.get(canvas.id).agent.agentId, 'finance');
  assert.equal(store.get(canvas.id).sessionKey, undefined);
  store.setSessionKey(canvas.id, 'agent:finance:canvas1');
  store.setAgent(canvas.id, { agentId: 'finance' });
  assert.equal(store.get(canvas.id).sessionKey, 'agent:finance:canvas1');
  store.setAgent(canvas.id, { agentId: null });
  assert.equal(store.get(canvas.id).sessionKey, undefined);
});

test('append adds blocks as a new version with the default summary', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Card')], by: 'ano' });
  const result = store.append(canvas.id, [block('Stat'), block('Note')], 'you');
  assert.ok(result.ok);
  assert.deepEqual(result.canvas.blocks.map((b) => b.component), ['Card', 'Stat', 'Note']);
  assert.equal(result.canvas.version, 2);
  assert.equal(result.canvas.summary, 'Added 2 cards');
  assert.equal(result.canvas.updatedBy, 'you');
  assert.equal(store.get(canvas.id), result.canvas);
  const one = store.append(canvas.id, [block('Stat')], 'you', 'Pinned from chat');
  assert.equal(one.canvas.summary, 'Pinned from chat');
  assert.equal(store.append(canvas.id, [block('Stat')], 'you').canvas.summary, 'Added 1 card');
});

test('append rejects missing canvases, invalid or empty blocks and passing the block cap', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: Array.from({ length: 39 }, () => block('Card')), by: 'ano' });
  assert.equal(store.append('missing', [block('Card')], 'you').ok, false);
  assert.equal(store.append(canvas.id, [{ component: '1', props: {} }], 'you').ok, false);
  assert.equal(store.append(canvas.id, [], 'you').ok, false);
  const tooMany = store.append(canvas.id, [block('Card'), block('Card')], 'you');
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /maximum of 40/);
  assert.equal(store.get(canvas.id).version, 1);
  assert.ok(store.append(canvas.id, [block('Card')], 'you').ok);
  assert.equal(store.get(canvas.id).blocks.length, 40);
});

test('markRefreshed stamps the canvas without a new version', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Card')], by: 'ano' });
  store.markRefreshed(canvas.id, 12345);
  assert.equal(store.get(canvas.id).lastRefreshedAt, 12345);
  assert.equal(store.get(canvas.id).version, 1);
  store.markRefreshed(canvas.id);
  assert.ok(store.get(canvas.id).lastRefreshedAt > 1000);
  store.markRefreshed('missing');
});

test('v2 fields survive a save and reload', async () => {
  const storage = memoryStorage();
  const store = await readyStore(storage);
  const canvas = store.create({
    title: 'A',
    blocks: [block('Card')],
    by: 'ano',
    origin: { prompt: 'Q?', at: 9 },
    agent: { name: 'Helper', instructions: 'Be brief', model: 'opencode-go/kimi-k3', agentId: 'finance', refresh: 'open' },
  });
  store.setLocked(canvas.id, false);
  store.markRefreshed(canvas.id, 777);
  await store.flush();
  const reopened = await readyStore(storage);
  assert.deepEqual(reopened.get(canvas.id), store.get(canvas.id));
  assert.equal(reopened.get(canvas.id).lastRefreshedAt, 777);
  assert.equal(reopened.get(canvas.id).locked, false);
});

test('canvases saved before v2 load unlocked with the default agent', async () => {
  const v1 = (id, kind) => ({
    id,
    title: id,
    scope: 'private',
    pinned: true,
    kind,
    version: 1,
    updatedAt: 1,
    updatedBy: 'ano',
    summary: 'Created',
    blocks: [block('Card')],
    history: [{ version: 1, title: id, blocks: [block('Card')], at: 1, by: 'ano', summary: 'Created' }],
    sessionKey: 'agent:ano:old',
  });
  const storage = memoryStorage(JSON.stringify({ format: 1, canvases: [v1('old', 'user')] }));
  const store = await readyStore(storage);
  const old = store.get('old');
  assert.equal(old.locked, false);
  assert.deepEqual(old.agent, { name: null, instructions: '', model: null, modelName: null, agentId: null, refresh: 'manual' });
  assert.equal(old.origin, undefined);
  assert.equal(old.sessionKey, 'agent:ano:old');
  const home = store.get(HOME_CANVAS_ID);
  assert.equal(home.kind, 'home');
  assert.equal(home.locked, false);
  assert.equal(home.agent.refresh, 'daily');
});

test('a non-empty legacy today canvas seeds home once and is dropped', async () => {
  const today = {
    id: 'today',
    title: 'Today',
    scope: 'private',
    pinned: false,
    kind: 'today',
    version: 3,
    updatedAt: 5,
    updatedBy: 'ano',
    summary: 'Planned',
    blocks: [block('TaskList', { items: ['x'] })],
    history: [{ version: 3, title: 'Today', blocks: [block('TaskList', { items: ['x'] })], at: 5, by: 'ano', summary: 'Planned' }],
    sessionKey: 'agent:ano:dashboard:today',
  };
  const storage = memoryStorage(JSON.stringify({ format: 1, canvases: [today] }));
  const store = await readyStore(storage);
  assert.equal(store.get('today'), undefined);
  const home = store.get(HOME_CANVAS_ID);
  assert.equal(home.kind, 'home');
  assert.equal(home.title, 'Home');
  assert.equal(home.version, 3);
  assert.deepEqual(home.blocks, [block('TaskList', { items: ['x'] })]);
  assert.equal(home.sessionKey, 'agent:ano:dashboard:today');
  assert.equal(home.agent.refresh, 'daily');
  assert.equal(home.history[0].title, 'Home');
  await store.flush();
  const reopened = await readyStore(storage);
  assert.equal(reopened.get(HOME_CANVAS_ID).version, 3);
  assert.equal(reopened.getSnapshot().length, 1);
});

test('an empty legacy today canvas does not seed home; an existing home wins over a legacy today', async () => {
  const base = { scope: 'private', pinned: false, version: 1, updatedAt: 1, updatedBy: 'ano', summary: 'Created' };
  const mk = (id, kind, blocks) => ({ ...base, id, title: id, kind, blocks, history: [{ version: 1, title: id, blocks, at: 1, by: 'ano', summary: 'Created' }] });
  const empty = await readyStore(memoryStorage(JSON.stringify({ format: 1, canvases: [mk('today', 'today', [])] })));
  assert.deepEqual(empty.get(HOME_CANVAS_ID).blocks, []);
  assert.equal(empty.get('today'), undefined);
  const both = await readyStore(
    memoryStorage(JSON.stringify({ format: 1, canvases: [mk('today', 'today', [block('Card')]), mk(HOME_CANVAS_ID, 'home', [block('Stat')])] })),
  );
  assert.deepEqual(both.get(HOME_CANVAS_ID).blocks, [block('Stat')]);
  assert.equal(both.get('today'), undefined);
});

test('garbage v2 fields fall back to defaults on load', async () => {
  const base = {
    id: 'x',
    title: 'x',
    version: 1,
    blocks: [],
    history: [],
  };
  const storage = memoryStorage(
    JSON.stringify({
      canvases: [{ ...base, locked: 'yes', agent: { name: 5, refresh: 'weekly', model: 3, instructions: 7 }, origin: { prompt: 1 }, lastRefreshedAt: 'x' }],
    }),
  );
  const store = await readyStore(storage);
  const x = store.get('x');
  assert.equal(x.locked, false);
  assert.deepEqual(x.agent, { name: null, instructions: '', model: null, modelName: null, agentId: null, refresh: 'manual' });
  assert.equal(x.origin, undefined);
  assert.equal(x.lastRefreshedAt, undefined);
});

// ---- keepLayout ---------------------------------------------------------------------------------

test('keepLayout accepts a rewrite that only changes values', async () => {
  const store = await readyStore();
  const canvas = store.create({
    title: 'A',
    blocks: [block('Stat', { label: 'Spend', value: '10' }), block('Card', { title: 'x', children: [block('Note', { text: 'a' }), block('Stat', { value: '1' })] })],
    by: 'ano',
  });
  const result = store.applyUpdate(
    canvas.id,
    {
      summary: 'Refreshed: spend updated',
      blocks: [block('Stat', { label: 'Spend', value: '99' }), block('Card', { title: 'y', children: [block('Note', { text: 'b' }), block('Stat', { value: '2' })] })],
    },
    'ano',
    { keepLayout: true },
  );
  assert.ok(result.ok);
  assert.equal(result.canvas.version, 2);
  assert.equal(result.canvas.blocks[0].props.value, '99');
});

test('keepLayout accepts a patch that only replaces values', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Stat', { value: '10' })], by: 'ano' });
  const result = store.applyUpdate(
    canvas.id,
    { base: 1, ops: [{ op: 'replace', path: '/blocks/0/props/value', value: '11' }] },
    'ano',
    { keepLayout: true },
  );
  assert.ok(result.ok);
  assert.equal(result.canvas.blocks[0].props.value, '11');
});

test('keepLayout rejects changed, added, removed or reordered components and changes nothing', async () => {
  const store = await readyStore();
  const original = [block('Stat', { value: '1' }), block('Card', { children: [block('Note'), block('Stat')] })];
  const canvas = store.create({ title: 'A', blocks: original, by: 'ano' });
  const attempts = [
    [block('Card', { value: '1' }), original[1]],
    [original[0]],
    [...original, block('Note')],
    [original[1], original[0]],
    [original[0], block('Card', { children: [block('Stat'), block('Note')] })],
    [original[0], block('Card', { children: [block('Note')] })],
    [original[0], block('Card', { children: [block('Note'), block('Stat'), block('Stat')] })],
  ];
  for (const blocks of attempts) {
    const result = store.applyUpdate(canvas.id, { summary: 's', blocks, scope: 'household' }, 'ano', { keepLayout: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /^layout is locked: /);
  }
  const viaOps = store.applyUpdate(canvas.id, { base: 1, ops: [{ op: 'add', path: '/blocks/-', value: block('Note') }] }, 'ano', { keepLayout: true });
  assert.equal(viaOps.ok, false);
  const current = store.get(canvas.id);
  assert.equal(current.version, 1);
  assert.equal(current.scope, 'private');
  assert.deepEqual(current.blocks, original);
});

test('without keepLayout the same structural change is accepted, and keepLayout ignores title-only updates', async () => {
  const store = await readyStore();
  const canvas = store.create({ title: 'A', blocks: [block('Stat')], by: 'ano' });
  assert.ok(store.applyUpdate(canvas.id, { title: 'B' }, 'ano', { keepLayout: true }).ok);
  assert.ok(store.applyUpdate(canvas.id, { blocks: [block('Card'), block('Note')] }, 'ano').ok);
});
