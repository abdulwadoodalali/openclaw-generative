// The recorded demo thread (HANDOFF step 8): scripted user turns and assistant replies whose
// `ano-ui` fences show every built-in component, one `ano-define` of a new component and a reply
// that uses it, and one deliberately broken fence to show the fallback card. Pure TypeScript (no
// react, no expo) so Node tests and scripts/mock-gateway.mjs can import it.
//
// Every figure is made up and labelled "Sample data": `sample: true` on MoneyGlance, LineChart and
// BarChart, a "Sample data" badge or caption next to everything else. The figures agree with each
// other: October budget $2,600, spent $2,190 (the bars add up), left $410, weekly budget $520.
import type { ComponentDefinition, JsonObject } from '../types.ts';

export type DemoTurn = {
  /** The user message the demo plays (also the label of the matching suggestion chip). */
  user: string;
  /** Raw assistant text, as the gateway would stream it. Starts with the `**Ano**` persona prefix. */
  reply: string;
};

export type DemoScript = {
  turns: DemoTurn[];
  /** Reply to a message that matches no turn once every turn was played. */
  fallbackReply: string;
};

/** The component whose fence is broken on purpose (the fallback card shows its raw text). */
export const DEMO_BROKEN_COMPONENT = 'Progress';

const FENCE = '```';

function uiFence(component: string, props: JsonObject): string {
  return [`${FENCE}ano-ui`, JSON.stringify({ component, props }), FENCE].join('\n');
}

function reply(...parts: string[]): string {
  return parts.join('\n\n');
}

const SAMPLE = 'Sample data';

// ---- the component the assistant defines in the demo (data only, rendered by the interpreter) ----

export const GROCERY_BUDGET_BARS: ComponentDefinition = {
  name: 'GroceryBudgetBars',
  version: 1,
  description: 'Grocery categories as progress bars against their budgets, with a review button.',
  props: {
    type: 'object',
    required: ['title', 'categories'],
    properties: {
      title: { type: 'string', description: 'Small sentence-case heading' },
      sample: { type: 'boolean', description: 'true shows a "Sample data" badge' },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          required: ['label', 'spent', 'budget'],
          properties: {
            label: { type: 'string' },
            spent: { type: 'number' },
            budget: { type: 'number' },
          },
        },
      },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Card', title: '{{title}}', children: ['badge', 'list', 'review'] },
    badge: { t: 'Badge', if: '{{sample}}', text: SAMPLE, tone: 'muted' },
    list: { t: 'List', items: '{{categories}}', template: 'row', gap: 12 },
    row: { t: 'Stack', gap: 4, children: ['head', 'bar'] },
    head: { t: 'Stack', dir: 'row', justify: 'between', align: 'center', children: ['label', 'amounts'] },
    label: { t: 'Text', text: '{{item.label}}', variant: 'label' },
    amounts: { t: 'Text', text: '{{item.spent|money}} of {{item.budget|money}}', variant: 'caption' },
    bar: { t: 'Progress', value: '{{item.spent}}', max: '{{item.budget}}' },
    review: { t: 'Button', label: 'Review groceries', variant: 'outline', action: { name: 'review', payload: { area: 'groceries' } } },
  },
  actions: ['review'],
};

// ---- the seven turns ------------------------------------------------------------------------------

const TURN_SNAPSHOT: DemoTurn = {
  user: 'How is my money doing this month?',
  reply: reply(
    '**Ano** Here is your October snapshot. These are sample figures: no accounts are linked in this demo.',
    uiFence('MoneyGlance', {
      month: 'October',
      spent: 2190,
      left: 410,
      cash: 8940,
      budgetLine: 90,
      sample: true,
      series: [12, 18, 24, 30, 37, 45, 52, 61, 70, 78, 88, 97],
    }),
    'Three numbers from the last seven days:',
    uiFence('StatRow', {
      title: `This week · ${SAMPLE}`,
      items: [
        { label: 'Spent', value: '$502', delta: '-$38 vs last week', tone: 'accent' },
        { label: 'Left today', value: '$41', tone: 'default' },
        { label: 'Bills due', value: '2', delta: 'by Oct 16', tone: 'danger' },
      ],
    }),
    'Groceries are the category to watch:',
    uiFence('Card', {
      title: 'Grocery budget',
      children: [
        { component: 'Progress', props: { label: 'Groceries', value: 412, max: 500, caption: '$88 left for the month' } },
        { component: 'Badge', props: { text: SAMPLE, tone: 'muted' } },
      ],
    }),
    'Spending is **slightly ahead** of plan. Want the trend or the breakdown?',
    uiFence('Suggestions', { options: ['Show the trend', 'Break it down'] }),
  ),
};

const TURN_TREND: DemoTurn = {
  user: 'Show the trend',
  reply: reply(
    '**Ano** Weekly spend over time. Switch the range to compare the last month, three months and a year. The dashed line is your $520 weekly budget.',
    uiFence('LineChart', {
      title: 'Weekly spend',
      format: 'money',
      budgetLine: 520,
      sample: true,
      ranges: {
        '1M': [
          { label: 'Sep 14', value: 498 },
          { label: 'Sep 21', value: 540 },
          { label: 'Sep 28', value: 585 },
          { label: 'Oct 5', value: 560 },
          { label: 'Oct 12', value: 502 },
        ],
        '3M': [
          { label: 'Jul 20', value: 470 },
          { label: 'Jul 27', value: 455 },
          { label: 'Aug 3', value: 510 },
          { label: 'Aug 10', value: 488 },
          { label: 'Aug 17', value: 530 },
          { label: 'Aug 24', value: 495 },
          { label: 'Aug 31', value: 515 },
          { label: 'Sep 7', value: 478 },
          { label: 'Sep 14', value: 498 },
          { label: 'Sep 21', value: 540 },
          { label: 'Sep 28', value: 585 },
          { label: 'Oct 5', value: 560 },
          { label: 'Oct 12', value: 502 },
        ],
        '1Y': [
          { label: 'Nov', value: 540 },
          { label: 'Dec', value: 640 },
          { label: 'Jan', value: 505 },
          { label: 'Feb', value: 470 },
          { label: 'Mar', value: 492 },
          { label: 'Apr', value: 488 },
          { label: 'May', value: 510 },
          { label: 'Jun', value: 525 },
          { label: 'Jul', value: 468 },
          { label: 'Aug', value: 500 },
          { label: 'Sep', value: 541 },
          { label: 'Oct', value: 537 },
        ],
      },
    }),
    'Three of the last five weeks ran over the line, and the peak was the week of Sep 28:',
    uiFence('Stack', {
      dir: 'row',
      gap: 16,
      children: [
        { component: 'Stat', props: { label: 'Weekly average', value: '$537', delta: '+$17 vs plan' } },
        { component: 'Stat', props: { label: 'Peak week', value: '$585', delta: 'Sep 28', tone: 'danger' } },
      ],
    }),
    uiFence('Text', { text: `${SAMPLE}: figures are made up for this recording.`, variant: 'caption', tone: 'muted' }),
    uiFence('Suggestions', { options: ['Break it down'] }),
  ),
};

const TURN_BREAKDOWN: DemoTurn = {
  user: 'Break it down',
  reply: reply(
    '**Ano** Here is where October went, each category against its own budget.',
    uiFence('Heading', { text: 'Where it went', level: 2 }),
    uiFence('BarChart', {
      title: 'Spent vs budget',
      format: 'money',
      sample: true,
      bars: [
        { label: 'Home', value: 640, max: 700 },
        { label: 'Groceries', value: 412, max: 500 },
        { label: 'Dining', value: 238, max: 200 },
        { label: 'Fun', value: 120, max: 150 },
        { label: 'Transport', value: 96, max: 150 },
        { label: 'Other', value: 684, max: 900 },
      ],
    }),
    uiFence('Card', {
      title: 'Biggest overrun',
      tone: 'danger',
      body: 'Dining is $38 over its $200 budget, and there are still 19 days left in the month.',
      children: [
        { component: 'Badge', props: { text: 'Over budget', tone: 'danger' } },
        { component: 'Text', props: { text: SAMPLE, variant: 'caption', tone: 'muted' } },
      ],
    }),
    'Tap a bar to ask me about that category. I can also turn this into a short checklist for the week.',
    uiFence('Suggestions', { options: ['Plan the week'] }),
  ),
};

const TURN_WEEK: DemoTurn = {
  user: 'Plan the week',
  reply: reply(
    '**Ano** A short plan that fixes the dining overrun and keeps the bills on time. Tick things off as you go and I will see it.',
    uiFence('TaskList', {
      title: 'This week',
      tasks: [
        { id: 'bill-electric', title: 'Pay the electricity bill', due: '2026-10-14' },
        { id: 'move-savings', title: 'Move $200 to savings', due: '2026-10-16' },
        { id: 'review-dining', title: 'Review the dining budget', due: '2026-10-18' },
        { id: 'cancel-stream', title: 'Cancel the unused streaming plan', done: true },
      ],
    }),
    uiFence('Badge', { text: SAMPLE, tone: 'muted' }),
    'If you like, I can make you a reusable grocery view for this.',
    uiFence('Suggestions', { options: ['Make me a grocery budget view'] }),
  ),
};

const TURN_SECTIONS: DemoTurn = {
  user: 'Fold the week into sections',
  reply: reply(
    '**Ano** Here is the week folded into sections. Prose and cards stay in the order I write them, and a section opens and closes in place:',
    uiFence('Collapsible', {
      title: 'Bills and money',
      subtitle: 'Two lists',
      open: true,
      children: [
        {
          component: 'TaskList',
          props: {
            title: 'Bills',
            tasks: [
              { id: 'sec-electric', title: 'Pay the electricity bill', due: '2026-10-14' },
              { id: 'sec-internet', title: 'Pay the internet bill', due: '2026-10-15', done: true },
            ],
          },
        },
        {
          component: 'TaskList',
          props: {
            title: 'Savings',
            tasks: [
              { id: 'sec-move', title: 'Move $200 to savings', due: '2026-10-16' },
              { id: 'sec-review', title: 'Review the dining budget', due: '2026-10-18' },
            ],
          },
        },
      ],
    }),
    'Even if a reply writes its sections as HTML details, the app draws them as the same native, tappable sections with the cards inside:',
    [
      '<details>',
      '<summary>Later this month</summary>',
      uiFence('TaskList', {
        title: 'Later',
        tasks: [
          { id: 'sec-passport', title: 'Renew the passport', due: '2026-10-28' },
          { id: 'sec-tax', title: 'Collect the tax slips', due: '2026-10-30' },
        ],
      }),
      '</details>',
    ].join('\n\n'),
    'That is all for the week.',
    uiFence('Suggestions', { options: ['Make me a grocery budget view'] }),
  ),
};

const TURN_DEFINE: DemoTurn = {
  user: 'Make me a grocery budget view',
  reply: reply(
    '**Ano** Done. I am defining a small component of my own, `GroceryBudgetBars`: data only, no code, drawn by the same interpreter as the built-ins.',
    [`${FENCE}ano-define`, JSON.stringify(GROCERY_BUDGET_BARS), FENCE].join('\n'),
    'It is saved on this device and I will remember it in later threads. Say the word and I will use it.',
    uiFence('Suggestions', { options: ['Show it for this month'] }),
  ),
};

const TURN_USE: DemoTurn = {
  user: 'Show it for this month',
  reply: reply(
    '**Ano** Here it is, using the component I just defined:',
    uiFence('GroceryBudgetBars', {
      title: 'Groceries · October',
      sample: true,
      categories: [
        { label: 'Produce', spent: 118, budget: 140 },
        { label: 'Meat and fish', spent: 132, budget: 130 },
        { label: 'Pantry', spent: 96, budget: 120 },
        { label: 'Household', spent: 66, budget: 110 },
      ],
    }),
    'Tapping Review groceries sends me an event, and I answer like any other message. One last thing: the next block is **broken on purpose** (the value is text and the max is missing) so you can see how the app degrades instead of crashing:',
    [`${FENCE}ano-ui`, '{"component":"Progress","props":{"label":"Dining","value":"a lot"}}', FENCE].join('\n'),
    'That grey card is the fallback: the raw block stays readable and the rest of the thread is untouched.',
  ),
};

export const DEMO_SCRIPT: DemoScript = {
  turns: [TURN_SNAPSHOT, TURN_TREND, TURN_BREAKDOWN, TURN_WEEK, TURN_SECTIONS, TURN_DEFINE, TURN_USE],
  fallbackReply:
    '**Ano** That is the end of the recorded demo. Use Replay all to run it again, or point Settings at the mock gateway to chat for real.',
};

/** Every turn as ONE assistant reply (scripts/mock-gateway.mjs answers "demo" with it). */
export const DEMO_FULL_REPLY: string = DEMO_SCRIPT.turns
  .map((turn, i) => (i === 0 ? turn.reply : turn.reply.replace(/^\*\*Ano\*\* /, '')))
  .join('\n\n');

// ---- chunker ------------------------------------------------------------------------------------

/** Sizes cycle so cuts land mid-word and inside fences, like a real token stream. */
const CHUNK_SIZES: readonly number[] = [32, 11, 56, 17, 40, 9, 45];

/** Splits a reply into the deltas a model would stream. `chunks.join('')` is exactly `text`. */
export function chunkReply(text: string, sizes: readonly number[] = CHUNK_SIZES): string[] {
  if (sizes.length === 0 || sizes.some((size) => !Number.isInteger(size) || size < 1)) {
    throw new Error('chunkReply sizes must be positive integers');
  }
  const chunks: string[] = [];
  let pos = 0;
  let turn = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + sizes[turn % sizes.length]);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end += 1; // keep surrogate pairs whole
    chunks.push(text.slice(pos, end));
    pos = end;
    turn += 1;
  }
  return chunks;
}
