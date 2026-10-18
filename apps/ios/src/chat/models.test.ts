// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/chat/models.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { modelOutcome, quickPicks } from './models.ts';

const model = (ref, available = true) => ({ ref, label: ref, provider: ref.split('/')[0], available });

test('models get a plain-language outcome, unknown models none', () => {
  assert.equal(modelOutcome('claude-cli/claude-sonnet-5-5'), 'Everyday, careful');
  assert.equal(modelOutcome('openrouter/anthropic/claude-sonnet-5.5'), 'Everyday, careful');
  assert.equal(modelOutcome('openrouter/google/gemini-3.8-flash'), 'Fast');
  assert.equal(modelOutcome('openrouter/google/gemini-3.1-pro-preview'), 'Long documents');
  assert.equal(modelOutcome('opencode-go/kimi-k3'), 'Reasoning');
  assert.equal(modelOutcome('opencode-go/deepseek-v4-flash'), 'Budget-friendly');
  assert.equal(modelOutcome('opencode-go/qwen3-max'), 'Multilingual');
  assert.equal(modelOutcome('opencode-go/minimax-m3'), 'Fast drafts');
  assert.equal(modelOutcome('acme/mystery-1'), null);
});

test('quick picks resolve to the first available model of each list', () => {
  const picks = quickPicks(
    [
      model('openrouter/google/gemini-3.8-flash'),
      model('opencode-go/deepseek-v4-flash'),
      model('claude-cli/claude-sonnet-5-5'),
      model('openrouter/anthropic/claude-sonnet-5.5'),
    ],
    'opencode-go/kimi-k3',
  );
  // What matters is which brain each pick resolves to; the hint copy is free to change.
  assert.deepEqual(
    picks.map(({ id, model, effort }) => ({ id, model, effort })),
    [
      { id: 'quick', model: 'openrouter/google/gemini-3.8-flash', effort: 'low' },
      // Balanced is the agent's own default: no model and no effort override.
      { id: 'balanced', model: null, effort: null },
      { id: 'deep', model: 'claude-cli/claude-sonnet-5-5', effort: 'max' },
    ],
  );
});

test('an unavailable first choice falls through to the next; a pick with no model left is dropped', () => {
  const picks = quickPicks(
    [
      model('openrouter/google/gemini-3.8-flash', false),
      model('opencode-go/deepseek-v4-flash'),
      model('claude-cli/claude-sonnet-5-5', false),
      model('openrouter/anthropic/claude-sonnet-5.5', false),
      model('openrouter/google/gemini-3.1-pro-preview'),
    ],
    null,
  );
  assert.equal(picks.find((p) => p.id === 'quick').model, 'opencode-go/deepseek-v4-flash');
  assert.equal(picks.find((p) => p.id === 'deep').model, 'openrouter/google/gemini-3.1-pro-preview');

  const onlyBalanced = quickPicks([model('openrouter/google/gemini-3.8-flash', false), model('claude-cli/claude-sonnet-5-5', false)], null);
  assert.deepEqual(onlyBalanced.map((p) => p.id), ['balanced']);
  assert.deepEqual(quickPicks([], null).map((p) => p.id), ['balanced']);
});

test('Balanced goes only when the agent default model is listed as unavailable', () => {
  const models = [model('opencode-go/kimi-k3', false), model('openrouter/google/gemini-3.8-flash')];
  assert.deepEqual(quickPicks(models, 'opencode-go/kimi-k3').map((p) => p.id), ['quick']);
  assert.deepEqual(quickPicks(models, 'opencode-go/not-listed').map((p) => p.id), ['quick', 'balanced']);
  assert.deepEqual(quickPicks(models, null).map((p) => p.id), ['quick', 'balanced']);
});
