// The ten built-ins that are plain data: they render through the same interpreter as definitions the
// assistant writes at runtime. MoneyGlance, LineChart and BarChart are React code (see codeMeta.ts).
// Pure TypeScript. Sample figures never appear here; instances carry their own data.
import { SPACING, TONES, type ComponentDefinition, type PropSchema } from '../types.ts';

const toneSchema: PropSchema = { type: 'string', enum: [...TONES], description: 'Color role' };

/** `{component, props}` instances rendered by an Embed node. */
const instancesSchema: PropSchema = {
  type: 'array',
  description: 'Nested components, each {component, props}',
  items: {
    type: 'object',
    required: ['component'],
    properties: {
      component: { type: 'string', description: 'Catalog component name' },
      props: { type: 'object', description: 'Props of that component' },
    },
  },
};

const Card: ComponentDefinition = {
  name: 'Card',
  version: 1,
  description:
    'Rounded white card with an optional sentence-case title and body text, holding other catalog components in children.',
  props: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Small sentence-case heading' },
      tone: toneSchema,
      body: { type: 'string', description: 'Paragraph under the title' },
      children: instancesSchema,
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Card', title: '{{title}}', tone: '{{tone}}', children: ['body', 'kids'] },
    body: { t: 'Text', if: '{{body}}', text: '{{body}}' },
    kids: { t: 'Embed', if: '{{children}}', items: '{{children}}' },
  },
};

const Stack: ComponentDefinition = {
  name: 'Stack',
  version: 1,
  description: 'Lays its children out in a column or a row with even spacing.',
  props: {
    type: 'object',
    required: ['children'],
    properties: {
      dir: { type: 'string', enum: ['column', 'row'], description: 'Default column' },
      gap: { type: 'integer', enum: [...SPACING], description: 'Space between children' },
      children: instancesSchema,
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Stack', dir: '{{dir}}', gap: '{{gap}}', children: ['kids'] },
    kids: { t: 'Embed', items: '{{children}}' },
  },
};

const Heading: ComponentDefinition = {
  name: 'Heading',
  version: 1,
  description: 'A heading line. Level 1 is the largest, 3 the smallest.',
  props: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      level: { type: 'integer', enum: [1, 2, 3], description: 'Default 2' },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Heading', text: '{{text}}', level: '{{level}}' },
  },
};

const Text: ComponentDefinition = {
  name: 'Text',
  version: 1,
  description: 'A line or paragraph of text in a type style and tone.',
  props: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      variant: { type: 'string', enum: ['body', 'lead', 'caption', 'label', 'mono'], description: 'Default body' },
      tone: toneSchema,
      bold: { type: 'boolean' },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Text', text: '{{text}}', variant: '{{variant}}', tone: '{{tone}}', bold: '{{bold}}' },
  },
};

const Badge: ComponentDefinition = {
  name: 'Badge',
  version: 1,
  description: 'A small status tag.',
  props: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      tone: toneSchema,
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Badge', text: '{{text}}', tone: '{{tone}}' },
  },
};

const Stat: ComponentDefinition = {
  name: 'Stat',
  version: 1,
  description: 'One figure with a small label above it and an optional change note below.',
  props: {
    type: 'object',
    required: ['label', 'value'],
    properties: {
      label: { type: 'string' },
      value: { type: 'string', description: 'Formatted text such as "$2,190"' },
      delta: { type: 'string', description: 'Change note such as "+4% vs last month"' },
      tone: toneSchema,
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Stat', label: '{{label}}', value: '{{value}}', delta: '{{delta}}', tone: '{{tone}}' },
  },
};

const StatRow: ComponentDefinition = {
  name: 'StatRow',
  version: 1,
  description: 'A card with a row of two to four stats side by side.',
  props: {
    type: 'object',
    required: ['items'],
    properties: {
      title: { type: 'string', description: 'Small sentence-case heading' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: { type: 'string', description: 'Formatted text such as "$2,190"' },
            delta: { type: 'string' },
            tone: toneSchema,
          },
        },
      },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Card', title: '{{title}}', children: ['row'] },
    row: { t: 'List', items: '{{items}}', template: 'stat', dir: 'row', gap: 12 },
    stat: { t: 'Stat', label: '{{item.label}}', value: '{{item.value}}', delta: '{{item.delta}}', tone: '{{item.tone}}' },
  },
};

const Progress: ComponentDefinition = {
  name: 'Progress',
  version: 1,
  description: 'A labelled progress bar showing value out of max, such as spending against a budget.',
  props: {
    type: 'object',
    required: ['label', 'value', 'max'],
    properties: {
      label: { type: 'string' },
      value: { type: 'number' },
      max: { type: 'number' },
      caption: { type: 'string', description: 'Small note under the bar' },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Stack', gap: 8, children: ['head', 'bar', 'caption'] },
    head: { t: 'Stack', dir: 'row', justify: 'between', align: 'center', children: ['label', 'amounts'] },
    label: { t: 'Text', text: '{{label}}', variant: 'label' },
    amounts: { t: 'Text', text: '{{value}} / {{max}}', variant: 'caption' },
    bar: { t: 'Progress', value: '{{value}}', max: '{{max}}' },
    caption: { t: 'Text', if: '{{caption}}', text: '{{caption}}', variant: 'caption' },
  },
};

const TaskList: ComponentDefinition = {
  name: 'TaskList',
  version: 1,
  description: 'A card with a checklist. Ticking a task tells the assistant (action toggle with the task id).',
  props: {
    type: 'object',
    required: ['tasks'],
    properties: {
      title: { type: 'string', description: 'Small sentence-case heading' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            done: { type: 'boolean' },
            due: { type: 'string', description: 'ISO date, shown as "Oct 12"' },
          },
        },
      },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'Card', title: '{{title}}', children: ['list'] },
    list: { t: 'List', items: '{{tasks}}', template: 'row', gap: 12 },
    row: { t: 'Stack', dir: 'row', align: 'center', gap: 8, children: ['check', 'due'] },
    check: {
      t: 'Checkbox',
      checked: '{{item.done}}',
      label: '{{item.title}}',
      action: { name: 'toggle', payload: { id: '{{item.id}}' } },
    },
    due: { t: 'Badge', if: '{{item.due}}', text: '{{item.due|date}}' },
  },
  actions: ['toggle'],
};

const Suggestions: ComponentDefinition = {
  name: 'Suggestions',
  version: 1,
  description: 'Tappable follow-up chips. Tapping one sends its text as the next user message (action pick).',
  props: {
    type: 'object',
    required: ['options'],
    properties: {
      options: { type: 'array', items: { type: 'string' }, description: 'Short chip labels, two to four' },
    },
  },
  root: 'root',
  nodes: {
    root: { t: 'List', items: '{{options}}', template: 'chip', dir: 'row', gap: 8, wrap: true },
    chip: { t: 'Button', label: '{{item}}', variant: 'outline', action: { name: 'pick', payload: { text: '{{item}}' } } },
  },
  actions: ['pick'],
};

export const BUILTIN_DEFINITIONS: ComponentDefinition[] = [
  Card,
  Stack,
  Heading,
  Text,
  Badge,
  Stat,
  StatRow,
  Progress,
  TaskList,
  Suggestions,
];
