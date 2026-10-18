// Catalog metadata for the built-ins drawn by React code (not by the interpreter). The registry
// lists these next to the definition built-ins and the model sees name, description and props in
// the catalog brief. Keep in sync with the Zod schemas in ../charts/schemas.ts. Pure TypeScript.
import type { CodeComponentMeta, PropSchema } from '../types.ts';

const FORMAT: PropSchema = {
  type: 'string',
  enum: ['money', 'percent', 'number'],
  description: 'How values are printed (money = $1,234)',
};

const POINTS: PropSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'x label, for example "Oct 12"' },
      value: { type: 'number' },
    },
    required: ['value'],
  },
};

export const CODE_BUILTINS: CodeComponentMeta[] = [
  {
    name: 'MoneyGlance',
    description:
      'Month snapshot card: spent, left and cash figures over a sparkline with a dashed budget line. Set sample:true unless the figures are real.',
    props: {
      type: 'object',
      required: ['month', 'spent', 'series'],
      properties: {
        month: { type: 'string', description: 'Month name, for example "October"' },
        spent: { type: 'number', description: 'Spent so far, in dollars' },
        left: { type: 'number', description: 'Budget left, in dollars' },
        cash: { type: 'number', description: 'Cash on hand, in dollars' },
        budgetLine: { type: 'number', description: 'Dashed budget reference on the series scale' },
        series: { type: 'array', items: { type: 'number' }, description: 'Spending trend, oldest first' },
        sample: { type: 'boolean', description: 'true shows a "Sample data" badge' },
      },
    },
  },
  {
    name: 'LineChart',
    description:
      'Titled area chart with a dashed budget line. Give ranges (1M, 3M, 1Y; shows a range switch) or a single series.',
    props: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        format: FORMAT,
        ranges: {
          type: 'object',
          description: 'Points per time range; only the ranges present get a switch button',
          properties: { '1M': POINTS, '3M': POINTS, '1Y': POINTS },
        },
        series: { ...POINTS, description: 'Single series, used when ranges is absent' },
        budgetLine: { type: 'number', description: 'Dashed budget reference on the value scale' },
        sample: { type: 'boolean', description: 'true shows a "Sample data" badge' },
      },
    },
  },
  {
    name: 'BarChart',
    description:
      'Labelled bars, optionally each against its own max (a faint track, for example a category budget). Tapping a bar sends action select {label}.',
    props: {
      type: 'object',
      required: ['bars'],
      properties: {
        title: { type: 'string' },
        format: FORMAT,
        bars: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
              max: { type: 'number', description: 'Optional limit drawn as a track behind the bar' },
            },
            required: ['label', 'value'],
          },
        },
        sample: { type: 'boolean', description: 'true shows a "Sample data" badge' },
      },
    },
  },
  {
    name: 'Collapsible',
    description:
      'Section header that expands to nested components in children (max 24), for anything that opens and closes. Never use HTML details for this.',
    props: {
      type: 'object',
      required: ['title', 'children'],
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string', description: 'Shown under the title; defaults to the item count' },
        open: { type: 'boolean', description: 'Start expanded (default false)' },
        children: {
          type: 'array',
          description: 'Nested components, each {component, props}',
          items: {
            type: 'object',
            required: ['component'],
            properties: {
              component: { type: 'string' },
              props: { type: 'object' },
            },
          },
        },
      },
    },
  },
  {
    name: 'BriefItem',
    description:
      'One Home card: a kind, a claim title, why now, a short stake, the agent it belongs to and one action whose prompt opens a chat. Answer cards add 2 to 4 options; today cards list events.',
    props: {
      type: 'object',
      required: ['title'],
      properties: {
        id: { type: 'string', description: 'Stable id: the same thing keeps the same id across refreshes' },
        kind: {
          type: 'string',
          enum: ['decide', 'answer', 'headsUp', 'moving', 'handled', 'today', 'tomorrow'],
          description: 'decide = waits on his OK, answer = a question for him, headsUp = act soon, moving = a goal, handled = a receipt',
        },
        title: { type: 'string', description: 'The claim, with a name and a number or date' },
        why: { type: 'string', description: 'Why now, under 100 characters' },
        stake: { type: 'string', description: 'Under 12 characters, for example "$214" or "Fri"' },
        agent: { type: 'string', description: 'Id of the agent the card belongs to' },
        source: { type: 'string', description: 'Where the fact came from, for example "Budget"' },
        at: { type: 'string', description: 'ISO time of the fact or action' },
        action: {
          type: 'object',
          required: ['label', 'prompt'],
          description: 'One verb button; its prompt starts a new chat',
          properties: {
            label: { type: 'string', description: 'A short verb, for example "Pay"' },
            prompt: { type: 'string', description: 'What to ask Ano when the button is tapped' },
          },
        },
        options: { type: 'array', items: { type: 'string' }, description: 'Answer cards: 2 to 4 short choices' },
        events: {
          type: 'array',
          description: 'Today cards: the next events',
          items: {
            type: 'object',
            required: ['time', 'title'],
            properties: {
              time: { type: 'string', description: '24-hour time, for example "14:00"' },
              title: { type: 'string' },
            },
          },
        },
      },
    },
  },
];
