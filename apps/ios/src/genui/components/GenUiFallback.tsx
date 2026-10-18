// What is drawn for a component that could not be drawn as designed (unknown name, props that
// failed validation, a render error). When the props are known (given directly or parseable from
// the raw fence body) the user gets a readable generic card built from them, with the JSON behind
// a "Show source" toggle. Only text that is not JSON at all lands on the quiet raw-text card, so
// nothing the assistant wrote is lost.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui';
import { propsFromSource } from '../genericView.ts';
import { GenericCard } from './GenericCard.tsx';

export type GenUiFallbackProps = {
  name: string;
  /** Raw fence body or props JSON. */
  raw?: string;
  /** Props of the instance, when already parsed. */
  props?: Record<string, unknown>;
  /** Short reason. */
  error?: string;
};

function captionFor(name: string, error: string | undefined): string {
  if (error === 'unknown component') return `There is no ${name} component in this app, so this is a simple view.`;
  return `Could not draw ${name} as designed, so this is a simple view.`;
}

export function GenUiFallback({ name, raw, props, error }: GenUiFallbackProps) {
  const known = useMemo(() => props ?? (raw ? propsFromSource(raw) : null), [props, raw]);

  if (known) {
    const source = raw ?? JSON.stringify(known, null, 2);
    return <GenericCard name={name} props={known} caption={captionFor(name, error)} source={source} error={error} />;
  }

  return (
    <View className="w-full gap-2 rounded-group bg-secondary p-3" accessibilityRole="text">
      <Text variant="caption">{`Could not draw ${name}`}</Text>
      {error ? (
        <Text variant="caption" numberOfLines={2}>
          {error}
        </Text>
      ) : null}
      {raw ? (
        <Text variant="mono" selectable numberOfLines={8} className="text-[12px] leading-[17px] text-muted-foreground">
          {raw}
        </Text>
      ) : null}
    </View>
  );
}
