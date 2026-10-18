// Home and Chat as two pages of one horizontal pager: Home first, Chat a swipe to the left. The
// page switches through src/lib/pager.ts (so a message sent from Home brings Chat forward), and a
// swipe reports back into the same store. No dots, no edge tab: the swipe is the control. A switch
// made in code (Home sending a message) slides 320ms on bezier(0.22, 1, 0.36, 1), so the new chat
// lands before the keyboard has finished going away.
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Easing,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useReduceMotion } from '../components/chat/useReduceMotion';
import { getPage, isPagerLocked, setPage, subscribe, subscribePagerLock, type Page } from '../lib/pager';
import { PagerGestureContext } from '../lib/pagerGesture';
import { colors } from '../theme';
import { ChatScreen } from './ChatScreen';
import { HomeScreen } from './HomeScreen';

/** A swipe is read once the scroll has been quiet this long (works the same on native and web). */
const SETTLE_MS = 120;
const SLIDE_MS = 320;
const slideEase = Easing.bezier(0.22, 1, 0.36, 1);

export function HomeChatPager() {
  const scrollRef = useRef<ScrollView>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const widthRef = useRef(0);
  const offsetRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideFrame = useRef<number | null>(null);
  const reduceMotion = useReduceMotion();
  const locked = useSyncExternalStore(subscribePagerLock, isPagerLocked, isPagerLocked);
  // The pager's own scroll as a gesture-handler gesture, so the triage deck can make it wait.
  const pagerGesture = useMemo(() => Gesture.Native(), []);
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;

  const cancelSlide = useCallback(() => {
    if (slideFrame.current !== null) cancelAnimationFrame(slideFrame.current);
    slideFrame.current = null;
  }, []);

  const jumpTo = useCallback((page: Page) => {
    if (widthRef.current === 0) return;
    scrollRef.current?.scrollTo({ x: page === 'chat' ? widthRef.current : 0, y: 0, animated: false });
  }, []);

  const slideTo = useCallback(
    (page: Page) => {
      const width = widthRef.current;
      if (width === 0) return;
      cancelSlide();
      const to = page === 'chat' ? width : 0;
      if (reduceRef.current) {
        jumpTo(page);
        return;
      }
      // The browser animates (and snaps) scrolling itself; frame by frame scrolling would fight its snap points.
      if (Platform.OS === 'web') {
        scrollRef.current?.scrollTo({ x: to, y: 0, animated: true });
        return;
      }
      const from = offsetRef.current;
      const startedAt = Date.now();
      const step = () => {
        const t = Math.min(1, (Date.now() - startedAt) / SLIDE_MS);
        scrollRef.current?.scrollTo({ x: from + (to - from) * slideEase(t), y: 0, animated: false });
        slideFrame.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      slideFrame.current = requestAnimationFrame(step);
    },
    [cancelSlide, jumpTo],
  );

  // A page change made elsewhere (Home sent a message, a deep link): slide there unless a swipe already did.
  useEffect(
    () =>
      subscribe(() => {
        const page = getPage();
        const width = widthRef.current;
        if (width === 0) return;
        const shown: Page = offsetRef.current > width / 2 ? 'chat' : 'home';
        if (shown === page) return;
        Keyboard.dismiss();
        slideTo(page);
      }),
    [slideTo],
  );

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current ?? undefined);
      cancelSlide();
    },
    [cancelSlide],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width === 0 || height === 0) return;
      const firstLayout = widthRef.current === 0;
      widthRef.current = width;
      setSize({ width, height });
      // Land on the page that was asked for before this view existed, or keep the page on rotation.
      if (firstLayout || offsetRef.current !== 0) {
        const page = getPage();
        offsetRef.current = page === 'chat' ? width : 0;
        requestAnimationFrame(() => jumpTo(page));
      }
    },
    [jumpTo],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    offsetRef.current = x;
    clearTimeout(settleTimer.current ?? undefined);
    settleTimer.current = setTimeout(() => {
      const width = widthRef.current;
      if (width > 0) setPage(offsetRef.current > width / 2 ? 'chat' : 'home');
    }, SETTLE_MS);
  }, []);

  // A finger on the pager takes over from a slide that is still running.
  const onScrollBeginDrag = useCallback(() => {
    cancelSlide();
    Keyboard.dismiss();
  }, [cancelSlide]);

  return (
    <View style={styles.root} onLayout={onLayout}>
      {size ? (
        <PagerGestureContext.Provider value={pagerGesture}>
          <GestureDetector gesture={pagerGesture}>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              bounces={false}
              scrollEnabled={!locked}
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScroll={onScroll}
              onScrollBeginDrag={onScrollBeginDrag}
              style={styles.flex}
              accessibilityLabel="Home and chat. Swipe sideways to switch"
            >
              <View style={{ width: size.width, height: size.height }}>
                <HomeScreen />
              </View>
              <View style={{ width: size.width, height: size.height }}>
                <ChatScreen />
              </View>
            </ScrollView>
          </GestureDetector>
        </PagerGestureContext.Provider>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
});
