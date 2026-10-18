// Card-shaped placeholder shown while a component's props are still streaming in.
import React from 'react';
import { View } from 'react-native';
import { Skeleton, Text } from '@/components/ui';
import { shadows } from '@/theme';

const CHART_LIKE = /chart|graph|glance|trend|spark|plot/i;

export function GenUiSkeleton({ name }: { name: string }) {
  const tall = CHART_LIKE.test(name);
  return (
    <View
      className="w-full gap-3 rounded-card bg-card p-4"
      style={shadows.card}
      accessibilityRole="progressbar"
      accessibilityLabel={`Drawing ${name}`}
    >
      <Text variant="caption">{`Drawing ${name}`}</Text>
      <Skeleton className="h-4 w-1/3" />
      {tall ? (
        <>
          <View className="flex-row gap-2">
            <Skeleton className="h-7 flex-1" />
            <Skeleton className="h-7 flex-1" />
            <Skeleton className="h-7 flex-1" />
          </View>
          <Skeleton className="h-[112px] w-full rounded-tile" />
        </>
      ) : (
        <>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </>
      )}
    </View>
  );
}
