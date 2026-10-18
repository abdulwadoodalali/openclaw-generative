// Header row shared by the chart cards: small sentence-case title, "Sample data" chip on the right.
import React from 'react';
import { View } from 'react-native';
import { Badge, Text } from '@/components/ui';

export function CardHeader({ title, sample }: { title?: string; sample?: boolean }) {
  if (!title && !sample) return null;
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text variant="label" numberOfLines={1} className="flex-1">
        {title ?? ''}
      </Text>
      {sample ? <Badge>Sample data</Badge> : null}
    </View>
  );
}
