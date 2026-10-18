// 1M / 3M / 1Y style segmented switch built from Pressable, as in design/Chat.dc.html:
// quiet track, white selected pill with a hairline shadow. Local view state only.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui';
import { shadows } from '@/theme';

export type RangeSwitchProps = {
  options: readonly string[];
  value: string;
  onChange: (option: string) => void;
};

export function RangeSwitch({ options, value, onChange }: RangeSwitchProps) {
  return (
    <View className="flex-row gap-[2px] rounded-[10px] bg-secondary p-[2px]" accessibilityRole="tablist">
      {options.map((option) => {
        const on = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className={on ? 'h-8 flex-1 items-center justify-center rounded-[8px] bg-card' : 'h-8 flex-1 items-center justify-center rounded-[8px]'}
            style={on ? shadows.button : undefined}
          >
            <Text className={on ? 'text-[13px] font-semibold text-foreground' : 'text-[13px] text-foreground'}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
