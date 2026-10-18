import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  type GestureResponderEvent,
} from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { colors } from '@/theme';
import { Text, TextClassContext } from './text';

export const buttonVariants = cva(
  'flex-row items-center justify-center',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        dark: 'bg-ink',
        outline: 'border border-input bg-card',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
        destructive: 'bg-destructive',
      },
      size: {
        default: 'h-11 px-4 rounded-pill',
        sm: 'h-9 px-3 rounded-pill',
        icon: 'h-11 w-11 p-0 rounded-pill',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export const buttonTextVariants = cva('font-medium text-center', {
  variants: {
    variant: {
      default: 'text-white',
      dark: 'text-white',
      outline: 'text-ink',
      secondary: 'text-ink',
      ghost: 'text-ink',
      destructive: 'text-white',
    },
    size: {
      default: 'text-[16px] leading-[22px]',
      sm: 'text-[13px] leading-[16px]',
      icon: 'text-[16px] leading-[22px]',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<typeof Pressable>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  ButtonProps
>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      disabled = false,
      loading = false,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const isInteractiveDisabled = Boolean(disabled || loading);

    const indicatorColor =
      variant === 'outline' || variant === 'secondary' || variant === 'ghost'
        ? colors.ink
        : colors.white;

    return (
      <TextClassContext.Provider
        value={buttonTextVariants({ variant, size })}
      >
        <Pressable
          ref={ref}
          role="button"
          accessibilityRole="button"
          aria-disabled={isInteractiveDisabled}
          disabled={isInteractiveDisabled}
          className={cn(
            buttonVariants({ variant, size }),
            className
          )}
          style={(state) => [
            {
              opacity: isInteractiveDisabled
                ? 0.4
                : state.pressed
                ? 0.85
                : 1,
            },
            typeof style === 'function' ? style(state) : style,
          ]}
          {...props}
        >
          {loading ? (
            <ActivityIndicator color={indicatorColor} />
          ) : typeof children === 'string' ? (
            <Text>{children}</Text>
          ) : (
            children
          )}
        </Pressable>
      </TextClassContext.Provider>
    );
  }
);

Button.displayName = 'Button';
