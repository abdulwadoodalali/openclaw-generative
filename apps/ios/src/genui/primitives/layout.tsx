// Layout primitives: Stack, Grid, Card, Section, Divider, Spacer, List, Embed.
import * as React from 'react';
import { View } from 'react-native';
import { Card, Separator, Text } from '@/components/ui';
import { asEnum, asNumber, asString, asTone, snapSpacing } from './coerce.ts';
import { CARD_TONE_CLASS } from './tone.ts';
import type { PrimitiveProps } from './types.ts';

/** Rows rendered by one List. */
export const MAX_LIST_ITEMS = 50;
/** Vertical rhythm inside a card (design/Chat.dc.html uses 14px between blocks). */
const CARD_GAP = 14;

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' } as const;

export function StackPrimitive({ fields, children }: PrimitiveProps) {
  const align = asEnum(fields.align, ['start', 'center', 'end', 'stretch'] as const, 'stretch');
  const justify = asEnum(fields.justify, ['start', 'center', 'end', 'between'] as const, 'start');
  return (
    <View
      style={{
        flexDirection: asEnum(fields.dir, ['column', 'row'] as const, 'column'),
        gap: snapSpacing(fields.gap, 8),
        alignItems: ALIGN[align],
        justifyContent: JUSTIFY[justify],
        flexWrap: fields.wrap === true ? 'wrap' : 'nowrap',
      }}
    >
      {children}
    </View>
  );
}

/** RN has no CSS grid: children are chunked into rows of equal flex cells. */
export function GridPrimitive({ fields, children }: PrimitiveProps) {
  const cols = Math.min(4, Math.max(1, Math.round(asNumber(fields.cols) ?? 2)));
  const gap = snapSpacing(fields.gap, 8);
  const cells = React.Children.toArray(children);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap }}>
          {Array.from({ length: cols }, (_, c) => (
            <View key={c} style={{ flex: 1 }}>
              {row[c]}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function CardPrimitive({ fields, children }: PrimitiveProps) {
  const title = asString(fields.title);
  const tone = asTone(fields.tone) ?? 'default';
  return (
    <Card className={CARD_TONE_CLASS[tone]} style={{ gap: CARD_GAP }}>
      {title ? <Text variant="label">{title}</Text> : null}
      {children}
    </Card>
  );
}

/** A titled group without a card surface. */
export function SectionPrimitive({ fields, children }: PrimitiveProps) {
  const title = asString(fields.title);
  const footer = asString(fields.footer);
  return (
    <View style={{ gap: 8 }}>
      {title ? <Text variant="label">{title}</Text> : null}
      {children}
      {footer ? <Text variant="caption">{footer}</Text> : null}
    </View>
  );
}

export function DividerPrimitive() {
  return <Separator />;
}

export function SpacerPrimitive({ fields }: PrimitiveProps) {
  const size = snapSpacing(fields.size, 8);
  return <View style={{ width: size, height: size }} />;
}

/** A Stack over data: the template node renders once per item (capped at MAX_LIST_ITEMS). */
export function ListPrimitive({ fields, ctx }: PrimitiveProps) {
  const items = Array.isArray(fields.items) ? fields.items.slice(0, MAX_LIST_ITEMS) : [];
  const row = asEnum(fields.dir, ['column', 'row'] as const, 'column') === 'row';
  const wrap = fields.wrap === true;
  return (
    <View style={{ flexDirection: row ? 'row' : 'column', gap: snapSpacing(fields.gap, 8), flexWrap: wrap ? 'wrap' : 'nowrap' }}>
      {items.map((item, index) => (
        <View key={index} style={row && !wrap ? { flex: 1 } : undefined}>
          {ctx.renderTemplate(item, index)}
        </View>
      ))}
    </View>
  );
}

/** Nested `{component, props}` instances, rendered in place (no wrapper view). */
export function EmbedPrimitive({ fields, ctx }: PrimitiveProps) {
  return <>{ctx.renderInstances(fields.items)}</>;
}
