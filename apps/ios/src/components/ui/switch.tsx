import * as React from 'react';
import * as SwitchPrimitives from '@rn-primitives/switch';
import { cn } from '@/lib/cn';
import { shadows } from '@/theme';

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  className?: string;
}

export const Switch = React.forwardRef<
  SwitchPrimitives.RootRef,
  SwitchProps
>(({ className, checked, disabled, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    checked={checked}
    disabled={disabled}
    className={cn(
      'h-[31px] w-[51px] flex-row items-center rounded-full p-[2px]',
      checked ? 'bg-amber' : 'bg-secondary',
      disabled && 'opacity-40',
      className
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      style={shadows.button}
      className={cn(
        'h-[27px] w-[27px] rounded-full bg-white',
        checked ? 'translate-x-[20px]' : 'translate-x-0'
      )}
    />
  </SwitchPrimitives.Root>
));

Switch.displayName = 'Switch';
