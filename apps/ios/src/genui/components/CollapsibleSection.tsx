// A tappable header row (title, subtitle, rotating chevron) that expands to show its children.
// Shared by the `Collapsible` code built-in and by native `<details>` sections in assistant
// markdown. Children mount only while open, so a collapsed section costs one row.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Text } from '@/components/ui';
import { colors, shadows } from '@/theme';

export type CollapsibleSectionProps = {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
};

const CHEVRON = 9;

export function CollapsibleSection({ title, subtitle, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const turn = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [open, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['-45deg', '45deg'] });

  return (
    <View className="w-full gap-3">
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        accessibilityState={{ expanded: open }}
        className="min-h-[44px] w-full flex-row items-center gap-3 rounded-group bg-card px-4 py-2 active:opacity-80"
        style={shadows.card}
      >
        <View className="flex-1 gap-[1px]">
          <Text variant="title" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Animated.View
          style={{
            width: CHEVRON,
            height: CHEVRON,
            marginRight: 3,
            borderRightWidth: 2,
            borderBottomWidth: 2,
            borderColor: colors.inkTertiary,
            transform: [{ rotate }],
          }}
        />
      </Pressable>
      {open ? <View className="w-full gap-3">{children}</View> : null}
    </View>
  );
}
