// Line icons for the chat screen (24px grid, round caps and joins), drawn like the ones in
// CanvasIcons.tsx. Icons that already exist there or in Icons.tsx are imported from those files.
import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme';

export type ChatIconProps = { size?: number; color?: string; strokeWidth?: number };

function Icon({ size = 20, color = colors.ink, strokeWidth = 2, children }: ChatIconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

/** Two short lines: the sidebar button. */
export function MenuIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 9h16M4 15h10" />
    </Icon>
  );
}

/** A house: Home. */
export function HomeIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 11l8-7 8 7" />
      <Path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" />
    </Icon>
  );
}

/** A square with a pen: a new chat. */
export function ComposeIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M12 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" />
      <Path d="M18.4 3.6a1.8 1.8 0 0 1 2.5 2.5L12 15l-3.5 1 1-3.5z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: ChatIconProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <Path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function CopyIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Rect x={9} y={9} width={11} height={11} rx={2.5} />
      <Path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </Icon>
  );
}

export function MoreIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Circle cx={5.5} cy={12} r={1.2} fill={props.color ?? colors.ink} />
      <Circle cx={12} cy={12} r={1.2} fill={props.color ?? colors.ink} />
      <Circle cx={18.5} cy={12} r={1.2} fill={props.color ?? colors.ink} />
    </Icon>
  );
}

export function ImageIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Rect x={3.5} y={4.5} width={17} height={15} rx={3} />
      <Circle cx={9} cy={10} r={1.6} />
      <Path d="M4 17l5-4.5 4 3.5 3-2.5 4 3" />
    </Icon>
  );
}

export function CameraIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.2-2h6.2l1.2 2h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <Circle cx={12} cy={12.5} r={3.2} />
    </Icon>
  );
}

export function ArrowDownIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M12 5v14M5 12l7 7 7-7" />
    </Icon>
  );
}

export function SearchIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Circle cx={11} cy={11} r={6.5} />
      <Path d="M16 16l4 4" />
    </Icon>
  );
}

export function PencilIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M15.5 4.5l4 4L8 20H4v-4z" />
    </Icon>
  );
}

export function TrashIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.2A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
    </Icon>
  );
}

export function ShareIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M12 15V4M8 8l4-4 4 4" />
      <Path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </Icon>
  );
}

/** A small text caret with lines: "Select text". */
export function TextSelectIcon(props: ChatIconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 7h16M4 12h16M4 17h9" />
    </Icon>
  );
}
