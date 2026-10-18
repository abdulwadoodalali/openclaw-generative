import type * as React from 'react';
import { PRIMITIVES, type PrimitiveName } from '../types.ts';
import { ButtonPrimitive, CheckboxPrimitive, PressablePrimitive, SegmentedPrimitive } from './controls.tsx';
import { BadgePrimitive, HeadingPrimitive, IconPrimitive, ImagePrimitive, StatPrimitive, TextPrimitive } from './content.tsx';
import {
  CardPrimitive,
  DividerPrimitive,
  EmbedPrimitive,
  GridPrimitive,
  ListPrimitive,
  SectionPrimitive,
  SpacerPrimitive,
  StackPrimitive,
} from './layout.tsx';
import type { PrimitiveProps } from './types.ts';
import { ChartPrimitive, ProgressPrimitive } from './visual.tsx';

export type { PrimitiveContext, PrimitiveProps } from './types.ts';

/** One renderer per name in PRIMITIVES (the compiler checks the record is complete). */
export const PRIMITIVE_COMPONENTS: Record<PrimitiveName, React.ComponentType<PrimitiveProps>> = {
  Stack: StackPrimitive,
  Grid: GridPrimitive,
  Card: CardPrimitive,
  Section: SectionPrimitive,
  Text: TextPrimitive,
  Heading: HeadingPrimitive,
  Stat: StatPrimitive,
  Badge: BadgePrimitive,
  Icon: IconPrimitive,
  Progress: ProgressPrimitive,
  Chart: ChartPrimitive,
  Image: ImagePrimitive,
  Divider: DividerPrimitive,
  Spacer: SpacerPrimitive,
  Pressable: PressablePrimitive,
  Button: ButtonPrimitive,
  Segmented: SegmentedPrimitive,
  Checkbox: CheckboxPrimitive,
  List: ListPrimitive,
  Embed: EmbedPrimitive,
};

export function isPrimitiveName(name: string): name is PrimitiveName {
  return PRIMITIVES.some((primitive) => primitive === name);
}
