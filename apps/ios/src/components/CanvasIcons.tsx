// Small line icons for the canvas screens, drawn like the ones in design/{Home,Canvas,Chat}.dc.html
// (24px grid, round caps and joins).
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../theme';
import type { IconProps } from './Icons';

type StrokeProps = IconProps & { strokeWidth?: number };

function Icon({ size = 20, color = colors.ink, strokeWidth = 2, children }: StrokeProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

/** Back chevron of the "Canvases" back button. */
export function ChevronLeftIcon(props: StrokeProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <Path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function ChevronRightIcon(props: StrokeProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <Path d="M9 5l7 7-7 7" />
    </Icon>
  );
}

/** The lock next to the scope switch (the system layer). */
export function LockIcon(props: StrokeProps) {
  return (
    <Icon {...props}>
      <Rect x={5} y={11} width={14} height={9} rx={2} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

/** An open padlock: the canvas can be changed. */
export function UnlockIcon(props: StrokeProps) {
  return (
    <Icon {...props}>
      <Rect x={5} y={11} width={14} height={9} rx={2} />
      <Path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </Icon>
  );
}

/** A circular arrow: refresh. */
export function RefreshIcon(props: StrokeProps) {
  return (
    <Icon {...props}>
      <Path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <Path d="M20 4v5h-5" />
    </Icon>
  );
}

/** The pin from the "Pin as canvas" button. */
export function PinIcon(props: StrokeProps) {
  return (
    <Icon {...props}>
      <Path d="M12 17v5" />
      <Path d="M9 3h6l-1 6 4 4H6l4-4z" />
    </Icon>
  );
}

export function CheckIcon(props: StrokeProps) {
  return (
    <Icon strokeWidth={2.6} {...props}>
      <Path d="M5 12l5 5 9-10" />
    </Icon>
  );
}
