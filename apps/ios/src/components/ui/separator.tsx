import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { cn } from '@/lib/cn';

export interface SeparatorProps
  extends React.ComponentPropsWithoutRef<typeof View> {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

export const Separator = React.forwardRef<
  React.ElementRef<typeof View>,
  SeparatorProps
>(
  (
    {
      className,
      orientation = 'horizontal',
      decorative = true,
      style,
      ...props
    },
    ref
  ) => {
    const isHorizontal = orientation === 'horizontal';

    return (
      <View
        ref={ref}
        role={decorative ? 'presentation' : 'separator'}
        aria-orientation={orientation}
        className={cn(
          'bg-separator shrink-0',
          isHorizontal ? 'w-full' : 'h-full',
          className
        )}
        style={[
          isHorizontal
            ? { height: StyleSheet.hairlineWidth }
            : { width: StyleSheet.hairlineWidth },
          style,
        ]}
        {...props}
      />
    );
  }
);

Separator.displayName = 'Separator';
