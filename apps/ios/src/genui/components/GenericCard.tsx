// Readable generic card for a component the app cannot draw as designed. The content comes from
// buildGenericModel (title, label/value rows, list rows, bullets, nested components); the raw JSON
// stays behind a small "Show source" toggle.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { colors } from '@/theme';
import { buildGenericModel, type GenericSection } from '../genericView.ts';
import { useRenderNode } from '../nodeContext.tsx';

export type GenericCardProps = {
  /** The component name, used for the title when the props have none. */
  name: string;
  props: Record<string, unknown>;
  /** One short muted line under the content. */
  caption: string;
  /** Raw source for the "Show source" toggle. */
  source: string;
  /** Why it could not be drawn as designed. */
  error?: string;
  /** Key prefix for nested instances. */
  idPrefix?: string;
};

const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator };

function Section({ section, idPrefix, index }: { section: GenericSection; idPrefix: string; index: number }) {
  const renderNode = useRenderNode();
  const heading = section.kind === 'fields' || !section.label ? null : <Text variant="label">{section.label}</Text>;
  switch (section.kind) {
    case 'fields':
      return (
        <View className="gap-2">
          {section.rows.map((row, i) => (
            <View key={i} className="flex-row items-baseline justify-between gap-3">
              <Text variant="secondary" className="shrink-0">
                {row.label}
              </Text>
              <Text variant="body" className="flex-1 text-right" selectable>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'bullets':
      return (
        <View className="gap-1">
          {heading}
          {section.items.map((item, i) => (
            <View key={i} className="flex-row gap-2">
              <Text variant="body">{'\u2022'}</Text>
              <Text variant="body" className="flex-1" selectable>
                {item}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'rows':
      return (
        <View className="gap-1">
          {heading}
          {section.rows.map((row, i) => (
            <View key={i} className="gap-[2px] py-2" style={i < section.rows.length - 1 ? divider : undefined}>
              <Text variant="body" selectable>
                {row.title}
              </Text>
              {row.secondary ? (
                <Text variant="secondary" selectable>
                  {row.secondary}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      );
    case 'nodes':
      return (
        <View className="gap-3">
          {heading}
          {renderNode
            ? section.nodes.map((node, i) => renderNode(node.component, node.props, `${idPrefix}.${index}.${i}`))
            : section.nodes.map((node, i) => (
                <Text key={i} variant="secondary">
                  {node.component}
                </Text>
              ))}
        </View>
      );
  }
}

export function GenericCard({ name, props, caption, source, error, idPrefix = 'generic' }: GenericCardProps) {
  const [showSource, setShowSource] = useState(false);
  const model = useMemo(() => buildGenericModel(name, props), [name, props]);

  return (
    <Card className="w-full gap-3">
      <Text variant="title">{model.title}</Text>
      {model.sections.map((section, i) => (
        <Section key={i} section={section} idPrefix={idPrefix} index={i} />
      ))}
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="caption" className="flex-1" numberOfLines={2}>
          {caption}
        </Text>
        <Pressable
          onPress={() => setShowSource((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={showSource ? 'Hide source' : 'Show source'}
          hitSlop={8}
        >
          <Text variant="caption" className="text-amber-text">
            {showSource ? 'Hide source' : 'Show source'}
          </Text>
        </Pressable>
      </View>
      {showSource ? (
        <View className="gap-2 rounded-tile bg-secondary p-3">
          {error ? <Text variant="caption">{error}</Text> : null}
          <Text variant="mono" selectable className="text-[12px] leading-[17px] text-muted-foreground">
            {source}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
