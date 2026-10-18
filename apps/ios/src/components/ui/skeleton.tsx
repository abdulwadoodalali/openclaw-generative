import * as React from 'react';
import { Animated, Platform, View } from 'react-native';
import { cn } from '@/lib/cn';

export interface SkeletonProps
  extends React.ComponentPropsWithoutRef<typeof Animated.View> {
  className?: string;
}

export const Skeleton = React.forwardRef<
  React.ElementRef<typeof View>,
  SkeletonProps
>(({ className, style, ...props }, ref) => {
  const opacity = React.useRef(new Animated.Value(0.45)).current;

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 900,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );

    pulse.start();

    return () => {
      pulse.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      ref={ref}
      className={cn('bg-secondary rounded-md', className)}
      style={[{ opacity }, style]}
      {...props}
    />
  );
});

Skeleton.displayName = 'Skeleton';
