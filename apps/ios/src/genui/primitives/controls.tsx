// Interactive primitives: Pressable, Button, Segmented, Checkbox. Every tap goes through
// ctx.actionHandler, which only fires actions the definition declared.
import * as React from 'react';
import { Pressable as RNPressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { colors, shadows } from '@/theme';
import { asEnum, asString, STATE_KEY_RE } from './coerce.ts';
import type { PrimitiveProps } from './types.ts';

const BUTTON_VARIANTS = { primary: 'default', secondary: 'secondary', ghost: 'ghost', outline: 'outline' } as const;
const MAX_SEGMENTS = 6;

export function PressablePrimitive({ fields, ctx, children }: PrimitiveProps) {
  const press = ctx.actionHandler(fields.action);
  return (
    <RNPressable
      accessibilityRole="button"
      disabled={!press}
      onPress={() => press?.()}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {children}
    </RNPressable>
  );
}

export function ButtonPrimitive({ fields, ctx }: PrimitiveProps) {
  const press = ctx.actionHandler(fields.action);
  const variant = asEnum(fields.variant, ['primary', 'secondary', 'ghost', 'outline'] as const, 'primary');
  return (
    <Button variant={BUTTON_VARIANTS[variant]} disabled={!press} onPress={() => press?.()}>
      {asString(fields.label) ?? ''}
    </Button>
  );
}

/** Segmented control (design/Chat.dc.html range switch). Its choice lives in local state under `bind`. */
export function SegmentedPrimitive({ fields, ctx }: PrimitiveProps) {
  const bind = asString(fields.bind);
  const options = (Array.isArray(fields.options) ? fields.options : [])
    .slice(0, MAX_SEGMENTS)
    .map(asString)
    .filter((option): option is string => option !== undefined);
  if (!bind || !STATE_KEY_RE.test(bind) || options.length === 0) return null;
  const stored = asString(ctx.state[bind]);
  const selected = stored !== undefined && options.includes(stored) ? stored : options[0];
  const press = ctx.actionHandler(fields.action);
  return (
    <View className="flex-row gap-[2px] rounded-[10px] bg-secondary p-[2px]">
      {options.map((option) => {
        const on = option === selected;
        return (
          <RNPressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              ctx.setState(bind, option);
              press?.({ value: option });
            }}
            className={cn('h-8 flex-1 items-center justify-center rounded-[8px]', on && 'bg-card')}
            style={on ? shadows.button : undefined}
          >
            <Text className={cn('text-[13px] leading-[16px]', on && 'font-semibold')}>{option}</Text>
          </RNPressable>
        );
      })}
    </View>
  );
}

/** Optimistic checkbox: flips immediately, then reports the new value; resyncs when the prop changes. */
export function CheckboxPrimitive({ fields, ctx }: PrimitiveProps) {
  const checked = fields.checked === true;
  // Optimistic value; reset during render (not in an effect) whenever the prop changes.
  const [synced, setSynced] = React.useState(checked);
  const [value, setValue] = React.useState(checked);
  if (synced !== checked) {
    setSynced(checked);
    setValue(checked);
  }
  const press = ctx.actionHandler(fields.action);
  const label = asString(fields.label);
  return (
    <RNPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled: !press }}
      disabled={!press}
      hitSlop={8}
      onPress={() => {
        setValue(!value);
        press?.({ value: !value });
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1, flexGrow: 1 }}
    >
      <View
        className={cn('h-[22px] w-[22px] items-center justify-center rounded-[7px] border', value ? 'border-primary bg-primary' : 'border-input bg-card')}
      >
        {value ? (
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={colors.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : null}
      </View>
      {label ? (
        <Text className={cn('flex-shrink', value && 'text-ink-secondary line-through')}>{label}</Text>
      ) : null}
    </RNPressable>
  );
}
