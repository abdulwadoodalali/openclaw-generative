import * as React from 'react';
import { Text as RNText } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { fonts } from '@/theme';

export const TextClassContext = React.createContext<string | undefined>(undefined);

export const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      body: 'text-[16px] leading-[22px] text-foreground',
      lead: 'text-[17px] leading-[24px] text-foreground',
      secondary: 'text-[13px] leading-[16px] text-muted-foreground',
      caption: 'text-[12px] leading-[16px] text-muted-foreground',
      label: 'text-[12px] leading-[16px] font-medium text-muted-foreground',
      title: 'text-[17px] leading-[22px] font-semibold text-foreground',
      display: 'text-[30px] leading-[36px] font-bold text-foreground',
      stat: 'text-[22px] leading-[28px] font-semibold text-foreground',
      mono: 'text-[13px] leading-[18px] text-foreground',
    },
  },
  defaultVariants: {
    variant: 'body',
  },
});

export type TextVariant = NonNullable<VariantProps<typeof textVariants>['variant']>;

export interface TextProps
  extends React.ComponentPropsWithoutRef<typeof RNText>,
    VariantProps<typeof textVariants> {
  className?: string;
}

export const Text = React.forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  ({ className, variant = 'body', style, ...props }, ref) => {
    const textClass = React.useContext(TextClassContext);
    const fontStyle =
      variant === 'display' || variant === 'stat'
        ? { fontFamily: fonts.rounded }
        : variant === 'mono'
        ? { fontFamily: fonts.mono }
        : undefined;

    return (
      <RNText
        ref={ref}
        className={cn(textVariants({ variant }), textClass, className)}
        style={fontStyle ? [fontStyle, style] : style}
        {...props}
      />
    );
  }
);

Text.displayName = 'Text';
