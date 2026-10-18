import * as React from 'react';
import { View } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Text, TextClassContext } from './text';

export const badgeVariants = cva(
  'inline-flex flex-row items-center justify-center rounded-chip px-2 py-[3px]',
  {
    variants: {
      variant: {
        default: 'bg-secondary',
        accent: 'bg-amber-tint',
        sage: 'bg-sage-tint',
        outline: 'border border-border bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export const badgeTextVariants = cva(
  'text-[11px] leading-[14px] font-medium text-center',
  {
    variants: {
      variant: {
        default: 'text-muted-foreground',
        accent: 'text-amber-text',
        sage: 'text-sage-text',
        outline: 'text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.ComponentPropsWithoutRef<typeof View>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<
  React.ElementRef<typeof View>,
  BadgeProps
>(({ className, variant = 'default', children, ...props }, ref) => {
  const textClass = badgeTextVariants({ variant });

  return (
    <TextClassContext.Provider value={textClass}>
      <View
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      >
        {typeof children === 'string' ? (
          <Text className={textClass}>{children}</Text>
        ) : (
          children
        )}
      </View>
    </TextClassContext.Provider>
  );
});

Badge.displayName = 'Badge';
