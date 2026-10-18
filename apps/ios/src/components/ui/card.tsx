import * as React from 'react';
import { View } from 'react-native';
import { cn } from '@/lib/cn';
import { shadows } from '@/theme';
import { Text, type TextProps } from './text';

export interface CardProps
  extends React.ComponentPropsWithoutRef<typeof View> {
  className?: string;
}

export const Card = React.forwardRef<
  React.ElementRef<typeof View>,
  CardProps
>(({ className, style, ...props }, ref) => (
  <View
    ref={ref}
    className={cn('rounded-card bg-card p-4', className)}
    style={[shadows.card, style]}
    {...props}
  />
));

Card.displayName = 'Card';

export interface CardHeaderProps
  extends React.ComponentPropsWithoutRef<typeof View> {
  className?: string;
}

export const CardHeader = React.forwardRef<
  React.ElementRef<typeof View>,
  CardHeaderProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn('flex flex-col gap-1.5 pb-2', className)}
    {...props}
  />
));

CardHeader.displayName = 'CardHeader';

export interface CardTitleProps extends TextProps {}

export const CardTitle = React.forwardRef<
  React.ElementRef<typeof Text>,
  CardTitleProps
>(({ className, variant = 'label', ...props }, ref) => (
  <Text
    ref={ref}
    variant={variant}
    className={cn(className)}
    {...props}
  />
));

CardTitle.displayName = 'CardTitle';

export interface CardContentProps
  extends React.ComponentPropsWithoutRef<typeof View> {
  className?: string;
}

export const CardContent = React.forwardRef<
  React.ElementRef<typeof View>,
  CardContentProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn('', className)}
    {...props}
  />
));

CardContent.displayName = 'CardContent';

export interface CardFooterProps
  extends React.ComponentPropsWithoutRef<typeof View> {
  className?: string;
}

export const CardFooter = React.forwardRef<
  React.ElementRef<typeof View>,
  CardFooterProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn('flex flex-row items-center pt-2', className)}
    {...props}
  />
));

CardFooter.displayName = 'CardFooter';
