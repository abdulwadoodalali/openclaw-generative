// Responsive chart width: spread `onLayout` on the container, draw once `width > 0`.
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export function useWidth(): [width: number, onLayout: (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  }, []);
  return [width, onLayout];
}
