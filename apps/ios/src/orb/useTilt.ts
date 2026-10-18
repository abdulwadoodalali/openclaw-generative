// The phone's tilt as a highlight offset for every mounted orb. One DeviceMotion subscription (30 Hz)
// is shared by all orbs that ask for it; the offset lives in two shared values, so the only JS work
// is the sensor listener. Off on the web and whenever no orb wants it (Reduce Motion).
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { makeMutable, type SharedValue } from 'react-native-reanimated';
import { DeviceMotion } from 'expo-sensors';
import { TILT_REST, stepTilt, tiltOffset, type TiltFilter } from './tilt.ts';

/** Largest highlight shift, in points (design-v5: ±3 pt). */
export const TILT_MAX_PT = 3;
const SAMPLE_MS = 33;

const tiltX = makeMutable(0);
const tiltY = makeMutable(0);
let users = 0;
let filter: TiltFilter = TILT_REST;
let subscription: { remove(): void } | null = null;

function start(): void {
  filter = TILT_REST;
  DeviceMotion.setUpdateInterval(SAMPLE_MS);
  subscription = DeviceMotion.addListener(({ rotation }) => {
    if (!rotation) return;
    filter = stepTilt(filter, rotation.beta, rotation.gamma);
    const offset = tiltOffset(filter, TILT_MAX_PT);
    tiltX.value = offset.x;
    tiltY.value = offset.y;
  });
}

function stop(): void {
  subscription?.remove();
  subscription = null;
  tiltX.value = 0;
  tiltY.value = 0;
}

/** The shared tilt offset (points). Subscribes to the sensor while `enabled`. */
export function useTilt(enabled: boolean): { x: SharedValue<number>; y: SharedValue<number> } {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    users += 1;
    if (users === 1) {
      void DeviceMotion.isAvailableAsync()
        .then((available) => {
          if (available && users > 0 && subscription === null) start();
        })
        .catch(() => undefined);
    }
    return () => {
      users -= 1;
      if (users === 0) stop();
    };
  }, [enabled]);
  return { x: tiltX, y: tiltY };
}
