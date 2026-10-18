// @ts-nocheck (node:test types are not installed; Node strips the types at runtime)
// Run: node --experimental-strip-types --test src/home/cards.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_STAKE, MAX_WHY, agentLabel, cardProblem, homeLayout, parseClock, readCard, waitingIds } from './cards.ts';

const action = { label: 'Pay', prompt: 'Pay the Hydro bill' };
const brief = (props) => ({ component: 'BriefItem', props });
const block = (component, props = {}) => ({ component, props });
const morning = new Date(2026, 9, 15, 9, 0);
const evening = new Date(2026, 9, 15, 19, 0);
const opts = (now = morning, hidden) => ({ now, eveningHour: 18, hidden });

test('a full card reads every contract field', () => {
  const card = readCard({
    id: 'hydro-oct',
    kind: 'decide',
    title: 'Hydro bill $214 due Friday',
    why: 'Autopay is off this month',
    stake: '$214',
    agent: 'finance',
    source: 'Budget',
    at: '2026-10-15T08:00:00Z',
    action,
  });
  assert.equal(card.id, 'hydro-oct');
  assert.equal(card.kind, 'decide');
  assert.equal(card.why, 'Autopay is off this month');
  assert.equal(card.stake, '$214');
  assert.equal(card.agent, 'finance');
  assert.deepEqual(card.action, action);
  assert.equal(card.at, Date.parse('2026-10-15T08:00:00Z'));
});

test('old cards stay readable: detail is the why, no kind is headsUp, a Tomorrow title is tomorrow', () => {
  const old = readCard({ title: 'Reply to Commercial Ops', detail: 'Due Friday', tone: 'household', action });
  assert.equal(old.kind, 'headsUp');
  assert.equal(old.why, 'Due Friday');
  assert.equal(old.tone, 'household');
  assert.equal(cardProblem(old), null);
  assert.equal(readCard({ title: 'Tomorrow: dentist at 9' }).kind, 'tomorrow');
  assert.equal(readCard({ title: 'x', kind: 'nonsense' }).kind, 'headsUp');
  assert.equal(readCard({ detail: 'no title' }), null);
});

test('a card without an id gets one from its title, the same every time', () => {
  const a = readCard({ title: 'Renew passport' });
  const b = readCard({ title: 'Renew passport', why: 'changed' });
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, readCard({ title: 'Renew licence' }).id);
});

test('why and stake are clipped; options only on answer cards, at most 4 and unique', () => {
  const card = readCard({ title: 'x', kind: 'answer', why: 'w'.repeat(150), stake: '1234567890123456', options: ['A', 'B', 'A', ' ', 'C', 'D', 'E'] });
  assert.ok(card.why.length <= MAX_WHY);
  assert.ok(card.why.endsWith('...'));
  assert.equal(card.stake.length, MAX_STAKE);
  assert.deepEqual(card.options, ['A', 'B', 'C', 'D']);
  assert.deepEqual(readCard({ title: 'x', kind: 'decide', options: ['A', 'B'] }).options, []);
});

test('decide, answer and headsUp cards without a why or an action are dropped; handled and moving need neither', () => {
  for (const kind of ['decide', 'answer', 'headsUp']) {
    assert.equal(cardProblem(readCard({ title: 'x', kind, action })), 'no why');
    assert.equal(cardProblem(readCard({ title: 'x', kind, why: 'y' })), 'no action');
    assert.equal(cardProblem(readCard({ title: 'x', kind, why: 'y', action: { label: 'Go' } })), 'no action');
    assert.equal(cardProblem(readCard({ title: 'x', kind, why: 'y', action })), null);
  }
  assert.equal(cardProblem(readCard({ title: 'Paid Hydro', kind: 'handled' })), null);
  assert.equal(cardProblem(readCard({ title: 'Visa step', kind: 'moving' })), null);
  assert.equal(cardProblem(readCard({ title: 'Today', kind: 'today', events: [] })), 'no events');
});

test('clock times parse in 24 hour, 12 hour and ISO forms', () => {
  assert.equal(parseClock('14:00'), 840);
  assert.equal(parseClock('9:05'), 545);
  assert.equal(parseClock('2:00 pm'), 840);
  assert.equal(parseClock('12am'), 0);
  assert.equal(parseClock('12:30 PM'), 750);
  assert.equal(parseClock(new Date(2026, 9, 15, 7, 45).toISOString()), 465);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('soon'), null);
});

test('the layout sorts cards by kind, keeps the agent order and drops vague and duplicate cards', () => {
  const blocks = [
    block('Heading', { text: 'Needs you' }),
    brief({ id: 'a', kind: 'decide', title: 'A', why: 'w', action }),
    brief({ id: 'h1', kind: 'headsUp', title: 'H1', why: 'w', action }),
    brief({ id: 'b', kind: 'answer', title: 'B', why: 'w', action, options: ['Yes', 'No'] }),
    brief({ id: 'vague', kind: 'decide', title: 'Vague' }),
    brief({ id: 'a', kind: 'decide', title: 'A again', why: 'w', action }),
    brief({ id: 'done1', kind: 'handled', title: 'Paid Hydro' }),
    brief({ id: 'm1', kind: 'moving', title: 'Visa' }),
    brief({ id: 'm2', kind: 'moving', title: 'Deal' }),
    block('MoneyGlance', { month: 'October' }),
  ];
  const layout = homeLayout(blocks, opts());
  assert.deepEqual(layout.needs.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(layout.headsUp.map((c) => c.id), ['h1']);
  assert.deepEqual(layout.handled.map((c) => c.id), ['done1']);
  assert.equal(layout.moving.id, 'm1');
  assert.deepEqual(layout.other.map((o) => o.index), [9]);
});

test('hidden needs-you cards leave the deck; old section headings go, a heading over other blocks stays', () => {
  const blocks = [
    brief({ id: 'a', kind: 'decide', title: 'A', why: 'w', action }),
    brief({ id: 'b', kind: 'decide', title: 'B', why: 'w', action }),
    block('Heading', { text: 'Coming up' }),
    brief({ title: 'Old item', detail: 'd', action }),
    block('Heading', { text: 'Money' }),
    block('StatRow', { stats: [] }),
    block('Heading', { text: 'Trailing' }),
  ];
  const layout = homeLayout(blocks, opts(morning, (id) => id === 'a'));
  assert.deepEqual(layout.needs.map((c) => c.id), ['b']);
  assert.deepEqual(layout.other.map((o) => o.block.component), ['Heading', 'StatRow']);
  assert.equal(layout.other[0].block.props.text, 'Money');
});

test('today keeps only events still to come; tomorrow shows only in the evening', () => {
  const blocks = [
    brief({ kind: 'today', title: 'Today', events: [{ time: '16:00', title: 'Gym' }, { time: '8:00', title: 'Standup' }, { time: 'later', title: 'x' }] }),
    brief({ kind: 'tomorrow', title: 'Tomorrow: dentist at 9' }),
  ];
  const day = homeLayout(blocks, opts());
  assert.deepEqual(day.today.card.events.map((e) => e.title), ['Standup', 'Gym']);
  assert.deepEqual(day.today.upcoming.map((e) => e.title), ['Gym']);
  assert.equal(day.tomorrow, null);
  const night = homeLayout(blocks, opts(evening));
  assert.deepEqual(night.today.upcoming, []);
  assert.equal(night.tomorrow.title, 'Tomorrow: dentist at 9');
});

test('waiting ids are every card but handled ones', () => {
  const ids = waitingIds([
    brief({ id: 'a', kind: 'decide', title: 'A' }),
    brief({ id: 'b', kind: 'handled', title: 'B' }),
    block('StatRow', { id: 'c' }),
  ]);
  assert.deepEqual([...ids], ['a']);
});

test('an unlisted agent id reads as a name', () => {
  assert.equal(agentLabel('ano-travel'), 'Travel');
  assert.equal(agentLabel('finance'), 'Finance');
  assert.equal(agentLabel('household_admin'), 'Household admin');
  assert.equal(agentLabel('ano-'), 'ano-');
});
