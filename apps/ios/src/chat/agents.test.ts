// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/chat/agents.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENTS_CACHE_MS, agentStatus, agentTone, clearAgentsCache, loadAgents, parseAgents } from './agents.ts';

const row = (id, name, extra = {}) => ({
  id,
  name,
  identity: { name },
  model: { primary: 'opencode-go/kimi-k3' },
  thinkingOptions: ['off', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  thinkingDefault: 'high',
  ...extra,
});

test('the default agent comes first, then main, then the rest in gateway order', () => {
  const rows = {
    agents: [
      row('pa-alex', 'PA Alex'),
      row('household', 'Household'),
      row('main', 'Ano'),
      row('notes', 'Ano Notes'),
      row('finance', 'Finance'),
      row('general', 'Ano General'),
    ],
  };
  assert.deepEqual(
    parseAgents(rows, 'general').map((a) => a.id),
    ['general', 'main', 'pa-alex', 'household', 'notes', 'finance'],
  );
  // Without a configured default, OpenClaw's main leads.
  assert.deepEqual(
    parseAgents(rows, 'main').map((a) => a.id),
    ['main', 'pa-alex', 'household', 'notes', 'finance', 'general'],
  );
});

test('hints come from the built-in map, specialists and unknown agents included', () => {
  const byId = Object.fromEntries(
    parseAgents({
      agents: [
        row('main', 'Ano'),
        row('finance', 'Finance'),
        row('notes', 'Notes'),
        row('household', 'Household'),
        row('pa-alex', 'PA Alex'),
        row('travel', 'Travel'),
      ],
    }).map((a) => [a.id, a.hint]),
  );
  assert.equal(byId.main, 'Your main OpenClaw agent');
  assert.equal(byId.finance, 'Budget, spending, accounts');
  assert.equal(byId.notes, 'Notes and research');
  assert.equal(byId.household, 'Shared with your household');
  assert.equal(byId['pa-alex'], 'Specialist');
  assert.equal(byId.travel, '');
});

test('name, initial, model and thinking options are read from the row', () => {
  const [general, main, bare] = parseAgents(
    {
      agents: [
        row('general', 'Ano General', { thinkingOptions: ['off', 'low'], thinkingDefault: 'low', model: { primary: 'openrouter/google/gemini-3.8-flash' } }),
        row('main', 'Ano'),
        { id: 'pa-alex', identity: { name: 'Alex' } },
      ],
    },
    'general',
  );
  assert.equal(general.name, 'Ano General');
  assert.equal(general.initial, 'G');
  assert.deepEqual(general.thinkingLevels, ['off', 'low']);
  assert.equal(general.thinkingDefault, 'low');
  assert.equal(general.defaultModel, 'openrouter/google/gemini-3.8-flash');
  assert.equal(main.initial, 'A');
  // A row with only an identity name: that name, and nulls for what is missing.
  assert.equal(bare.name, 'Alex');
  assert.equal(bare.initial, 'A');
  assert.deepEqual(bare.thinkingLevels, []);
  assert.equal(bare.thinkingDefault, null);
  assert.equal(bare.defaultModel, null);
});

test('a missing name falls back to the id, rows without an id are dropped, junk gives no agents', () => {
  const agents = parseAgents({ agents: [{ id: 'my-finance' }, { name: 'No id' }, null, 'x'] });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'My Finance');
  assert.deepEqual(parseAgents(null), []);
  assert.deepEqual(parseAgents({ agents: 'nope' }), []);
});

test('loadAgents caches for five minutes, shares in-flight requests and does not cache failures', async () => {
  clearAgentsCache();
  let calls = 0;
  let fail = true;
  const request = async (method) => {
    assert.equal(method, 'agents.list');
    calls += 1;
    if (fail) throw new Error('offline');
    return { agents: [row('main', 'Ano')] };
  };
  await assert.rejects(loadAgents(request, () => 0), /offline/);
  fail = false;
  const [a, b] = await Promise.all([loadAgents(request, () => 0), loadAgents(request, () => 0)]);
  assert.equal(calls, 2);
  assert.equal(a, b);
  await loadAgents(request, () => AGENTS_CACHE_MS - 1);
  assert.equal(calls, 2);
  await loadAgents(request, () => AGENTS_CACHE_MS + 1);
  assert.equal(calls, 3);
  clearAgentsCache();
});

test('household agents get the sage tone, everyone else the amber one', () => {
  assert.equal(agentTone('household'), 'household');
  assert.equal(agentTone('household-kids'), 'household');
  assert.equal(agentTone('household-shared'), 'household');
  for (const id of ['general', 'notes', 'main', 'pa-alex', 'travel', 'finance']) {
    assert.equal(agentTone(id), 'accent', id);
  }
});

test('the status line: Offline, Here with you, Thinking, the step, Answering', () => {
  const ready = { status: 'ready' };
  const run = (patch) => ({ mode: 'waiting', note: null, step: null, model: null, ...patch });
  assert.equal(agentStatus(null, ready), 'Here with you');
  assert.equal(agentStatus(run({}), ready), 'Thinking');
  assert.equal(agentStatus(run({ mode: 'thinking' }), ready), 'Thinking');
  assert.equal(agentStatus(run({ mode: 'working', step: 'Using Budget' }), ready), 'Using Budget');
  assert.equal(agentStatus(run({ mode: 'working', step: 'Asking Ano Finance' }), ready), 'Asking Ano Finance');
  assert.equal(agentStatus(run({ mode: 'answering' }), ready), 'Answering');
  // Offline wins over everything, a run or not.
  for (const status of ['idle', 'connecting', 'reconnecting', 'needs-pairing', 'auth-failed', 'error']) {
    assert.equal(agentStatus(null, { status }), 'Offline', status);
    assert.equal(agentStatus(run({ mode: 'thinking' }), { status }), 'Offline', status);
  }
});
