// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/canvas/models.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { MODELS_CACHE_MS, clearModelsCache, loadModels, modelLabel } from './models.ts';

const LIST = {
  models: [
    { id: 'kimi-k3', name: 'Kimi K3', provider: 'opencode-go', available: true, reasoning: true },
    { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'openrouter', available: false },
    { id: 'no-name', provider: 'x' },
    { name: 'broken' },
    null,
  ],
};

function fakeRequest(result = LIST) {
  const calls = [];
  const request = async (method, params) => {
    calls.push({ method, params });
    return result;
  };
  return { request, calls };
}

test('loadModels maps models.list rows to options with provider/id refs', async () => {
  clearModelsCache();
  const { request, calls } = fakeRequest();
  const models = await loadModels(request);
  assert.deepEqual(calls, [{ method: 'models.list', params: {} }]);
  assert.deepEqual(models, [
    { ref: 'opencode-go/kimi-k3', label: 'Kimi K3', provider: 'opencode-go', available: true },
    { ref: 'openrouter/google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'openrouter', available: false },
    { ref: 'x/no-name', label: 'no-name', provider: 'x', available: true },
  ]);
});

test('results are cached for five minutes and concurrent calls share one request', async () => {
  clearModelsCache();
  const { request, calls } = fakeRequest();
  let now = 1000;
  const [a, b] = await Promise.all([loadModels(request, () => now), loadModels(request, () => now)]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  now += MODELS_CACHE_MS - 1;
  await loadModels(request, () => now);
  assert.equal(calls.length, 1);
  now += 2;
  await loadModels(request, () => now);
  assert.equal(calls.length, 2);
});

test('a failed request is not cached', async () => {
  clearModelsCache();
  await assert.rejects(loadModels(async () => { throw new Error('offline'); }), /offline/);
  const { request, calls } = fakeRequest();
  assert.equal((await loadModels(request)).length, 3);
  assert.equal(calls.length, 1);
});

test('an unexpected result gives no models', async () => {
  clearModelsCache();
  assert.deepEqual(await loadModels(async () => ({ models: 'x' })), []);
});

test('modelLabel uses the loaded name and falls back to the id part of the ref', async () => {
  clearModelsCache();
  assert.equal(modelLabel('openrouter/google/gemini-3.8-flash'), 'google/gemini-3.8-flash');
  assert.equal(modelLabel('plain'), 'plain');
  await loadModels(fakeRequest().request);
  assert.equal(modelLabel('openrouter/google/gemini-3.8-flash'), 'Gemini 3.8 Flash');
  assert.equal(modelLabel('opencode-go/unknown'), 'unknown');
});
