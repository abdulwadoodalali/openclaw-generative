import * as React from 'react';
import {
  Platform,
  TextInput,
  type TextStyle,
} from 'react-native';
import { cn } from '@/lib/cn';
import { colors } from '@/theme';

export interface InputProps
  extends React.ComponentPropsWithoutRef<typeof TextInput> {
  className?: string;
}

const webInputStyle =
  Platform.OS === 'web'
    ? ({ outlineStyle: 'none' } as unknown as TextStyle)
    : undefined;

export const Input = React.forwardRef<
  React.ElementRef<typeof TextInput>,
  InputProps
>(({ className, placeholderTextColor, style, ...props }, ref) => (
  <TextInput
    ref={ref}
    placeholderTextColor={placeholderTextColor ?? colors.inkSecondary}
    className={cn(
      'h-11 rounded-pill bg-card border border-input px-4 text-[16px] text-foreground',
      props.editable === false && 'opacity-40',
      className
    )}
    style={[webInputStyle, style]}
    {...props}
  />
));

Input.displayName = 'Input';
