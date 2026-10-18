// The Home | Chat pager's native scroll gesture, for children whose own sideways gestures (the triage
// deck) must win over paging. A child declares `pan.blocksExternalGesture(pagerGesture)`, so the pager
// waits until the child's pan fails instead of both fighting for the same drag.
import { createContext, useContext } from 'react';
import type { NativeGesture } from 'react-native-gesture-handler';

export const PagerGestureContext = createContext<NativeGesture | null>(null);

export function usePagerGesture(): NativeGesture | null {
  return useContext(PagerGestureContext);
}
