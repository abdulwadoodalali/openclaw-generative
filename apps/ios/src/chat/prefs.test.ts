// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/chat/prefs.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { EFFORTS, VISIBLE_EFFORTS, asEffort, effortCopy } from './effort.ts';
import { parseChatPrefs } from './prefs.ts';
import { searchThreads } from './search.ts';
import { applySessionPrefs, patchSessionEffort, patchSessionModel } from './sessionPrefs.ts';

const KEY = 'agent:main:dashboard:t1';

function recorder(fail = () => false) {
  const calls = [];
  const request = async (method, params) => {
    calls.push({ method, params });
    if (fail(params)) throw new Error('rejected');
    return { ok: true };
  };
  return { calls, request };
}

test('effort levels are the picker levels in order, and unknown gateway levels map to null', () => {
  assert.deepEqual(
    EFFORTS.map((e) => [e.value, e.label]),
    [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max']],
  );
  assert.equal(asEffort('medium'), 'medium');
  assert.equal(asEffort('xhigh'), null);
  assert.equal(asEffort(undefined), null);
});

test('the picker shows Low to Max, and every effort has a plain-language line', () => {
  assert.deepEqual(VISIBLE_EFFORTS, ['low', 'medium', 'high', 'max']);
  assert.equal(effortCopy('low'), 'Quick and light');
  assert.equal(effortCopy('medium'), 'Balanced thinking');
  assert.equal(effortCopy('high'), 'Thinks it through');
  assert.equal(effortCopy('max'), 'Most thorough, slowest, uses more of your limit');
  for (const { value } of EFFORTS) assert.ok(effortCopy(value).length > 0, value);
  assert.ok(effortCopy(null).length > 0);
});

test('setting a model patches the session; null resets it to the agent default', async () => {
  const { calls, request } = recorder();
  await patchSessionModel(request, KEY, 'opencode-go/kimi-k3');
  await patchSessionModel(request, KEY, null);
  assert.deepEqual(calls, [
    { method: 'sessions.patch', params: { key: KEY, model: 'opencode-go/kimi-k3' } },
    { method: 'sessions.patch', params: { key: KEY, model: null } },
  ]);
});

test('setting an effort patches thinkingLevel; null resets it to the agent default', async () => {
  const { calls, request } = recorder();
  await patchSessionEffort(request, KEY, 'low');
  await patchSessionEffort(request, KEY, null);
  assert.deepEqual(calls, [
    { method: 'sessions.patch', params: { key: KEY, thinkingLevel: 'low' } },
    { method: 'sessions.patch', params: { key: KEY, thinkingLevel: null } },
  ]);
});

test('a new session gets the chosen model and effort, and only those', async () => {
  const both = recorder();
  assert.deepEqual(await applySessionPrefs(both.request, KEY, { model: 'opencode-go/kimi-k3', effort: 'high' }), {
    model: 'opencode-go/kimi-k3',
    effort: 'high',
  });
  assert.deepEqual(both.calls.map((c) => c.params), [
    { key: KEY, model: 'opencode-go/kimi-k3' },
    { key: KEY, thinkingLevel: 'high' },
  ]);

  const none = recorder();
  assert.deepEqual(await applySessionPrefs(none.request, KEY, { model: null, effort: null }), { model: null, effort: null });
  assert.equal(none.calls.length, 0);
});

test('a field the gateway rejects stays at the agent default and does not fail the chat', async () => {
  const { calls, request } = recorder((params) => 'model' in params);
  const applied = await applySessionPrefs(request, KEY, { model: 'bogus/model', effort: 'low' });
  assert.deepEqual(applied, { model: null, effort: 'low' });
  assert.equal(calls.length, 2);
});

test('stored defaults are read back, anything malformed falls back to the default agent', () => {
  assert.deepEqual(parseChatPrefs(JSON.stringify({ agentId: 'finance', model: 'a/b', effort: 'max' }), 'main'), {
    agentId: 'finance',
    model: 'a/b',
    effort: 'max',
  });
  const fallback = { agentId: 'main', model: null, effort: null };
  assert.deepEqual(parseChatPrefs(null, 'main'), fallback);
  assert.deepEqual(parseChatPrefs('not json', 'main'), fallback);
  assert.deepEqual(parseChatPrefs('[]', 'main'), fallback);
  assert.deepEqual(parseChatPrefs(JSON.stringify({ agentId: '', model: 3, effort: 'warp' }), 'main'), fallback);
});

test('search matches every word of the query in the title, case-insensitively', () => {
  const threads = [{ title: 'Budget review' }, { title: 'Trip planning' }, { title: 'Review the trip budget' }];
  assert.deepEqual(searchThreads(threads, 'BUDGET').map((t) => t.title), ['Budget review', 'Review the trip budget']);
  assert.deepEqual(searchThreads(threads, 'trip budget').map((t) => t.title), ['Review the trip budget']);
  assert.equal(searchThreads(threads, 'zzz').length, 0);
  assert.equal(searchThreads(threads, '   ').length, 3);
});
