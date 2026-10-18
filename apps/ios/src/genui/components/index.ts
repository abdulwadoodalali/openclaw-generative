// Code-rendered built-ins (charts, MoneyGlance, Collapsible, BriefItem) plus the skeleton and fallback cards.
import type { ComponentType } from 'react';
import type { CodeComponentProps } from '../types.ts';
import { BarChartCard } from './BarChartCard.tsx';
import { BriefItem } from './BriefItem.tsx';
import { Collapsible } from './Collapsible.tsx';
import { LineChartCard } from './LineChartCard.tsx';
import { MoneyGlance } from './MoneyGlance.tsx';

export { BarChartCard } from './BarChartCard.tsx';
export { Collapsible } from './Collapsible.tsx';
export { CollapsibleSection } from './CollapsibleSection.tsx';
export { GenericCard } from './GenericCard.tsx';
export { GenUiFallback } from './GenUiFallback.tsx';
export { GenUiSkeleton } from './GenUiSkeleton.tsx';
export { LineChartCard } from './LineChartCard.tsx';
export { MoneyGlance } from './MoneyGlance.tsx';
export { BriefItem } from './BriefItem.tsx';

/** Registry name -> component. Names match src/genui/builtins/codeMeta.ts. */
export const CODE_COMPONENTS: Record<string, ComponentType<CodeComponentProps>> = {
  MoneyGlance,
  LineChart: LineChartCard,
  BarChart: BarChartCard,
  Collapsible,
  BriefItem,
};
