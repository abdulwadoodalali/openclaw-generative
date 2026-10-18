// Content primitives: Text, Heading, Stat, Badge, Icon, Image.
import * as React from 'react';
import { Image, View } from 'react-native';
import { Badge, Text } from '@/components/ui';
import { ArrowUpIcon, GearIcon, GridIcon, MicIcon, PlusIcon, StopIcon, XIcon, type IconProps } from '@/components/Icons';
import { cn } from '@/lib/cn';
import { asEnum, asNumber, asString, asTone } from './coerce.ts';
import { NUMERAL_TONE_CLASS, TEXT_TONE_CLASS, TONE_COLOR } from './tone.ts';
import type { PrimitiveProps } from './types.ts';

export function TextPrimitive({ fields }: PrimitiveProps) {
  const variant = asEnum(fields.variant, ['body', 'lead', 'caption', 'label', 'mono'] as const, 'body');
  const tone = asTone(fields.tone);
  return (
    <Text variant={variant} className={cn(tone ? TEXT_TONE_CLASS[tone] : undefined, fields.bold === true && 'font-semibold')}>
      {asString(fields.text) ?? ''}
    </Text>
  );
}

export function HeadingPrimitive({ fields }: PrimitiveProps) {
  const level = asNumber(fields.level) ?? 2;
  const text = asString(fields.text) ?? '';
  if (level <= 1) {
    return (
      <Text variant="display" className="text-[26px] leading-[32px]" accessibilityRole="header">
        {text}
      </Text>
    );
  }
  if (level >= 3) {
    return (
      <Text variant="body" className="font-semibold" accessibilityRole="header">
        {text}
      </Text>
    );
  }
  return (
    <Text variant="title" accessibilityRole="header">
      {text}
    </Text>
  );
}

/** One figure: caption label, rounded numerals, optional change note (design/Chat.dc.html). */
export function StatPrimitive({ fields }: PrimitiveProps) {
  const label = asString(fields.label);
  const delta = asString(fields.delta);
  const tone = asTone(fields.tone) ?? 'default';
  return (
    <View style={{ gap: 2 }}>
      {label ? <Text variant="caption">{label}</Text> : null}
      <Text variant="stat" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className={NUMERAL_TONE_CLASS[tone]}>
        {asString(fields.value) ?? ''}
      </Text>
      {delta ? <Text variant="caption">{delta}</Text> : null}
    </View>
  );
}

export function BadgePrimitive({ fields }: PrimitiveProps) {
  const text = asString(fields.text) ?? '';
  const tone = asTone(fields.tone) ?? 'default';
  switch (tone) {
    case 'accent':
      return <Badge variant="accent">{text}</Badge>;
    case 'household':
      return <Badge variant="sage">{text}</Badge>;
    case 'muted':
      return <Badge variant="outline">{text}</Badge>;
    case 'danger':
      return (
        <Badge className="bg-destructive/10">
          <Text className="text-[11px] leading-[14px] font-medium text-center text-destructive">{text}</Text>
        </Badge>
      );
    default:
      return <Badge>{text}</Badge>;
  }
}

/** The icons the app already ships (src/components/Icons.tsx). Unknown names draw nothing. */
const ICONS: Record<string, React.ComponentType<IconProps>> = {
  gear: GearIcon,
  settings: GearIcon,
  'arrow-up': ArrowUpIcon,
  stop: StopIcon,
  x: XIcon,
  close: XIcon,
  grid: GridIcon,
  plus: PlusIcon,
  mic: MicIcon,
};

export function IconPrimitive({ fields }: PrimitiveProps) {
  const name = asString(fields.name);
  if (!name || !Object.prototype.hasOwnProperty.call(ICONS, name)) return null;
  const Icon = ICONS[name]!;
  const size = Math.min(32, Math.max(12, asNumber(fields.size) ?? 20));
  return <Icon size={size} color={TONE_COLOR[asTone(fields.tone) ?? 'default']} />;
}

/** https images only; anything else draws nothing. */
export function ImagePrimitive({ fields }: PrimitiveProps) {
  const uri = asString(fields.uri)?.trim();
  if (!uri || !/^https:\/\/[^\s]+$/i.test(uri)) return null;
  const height = Math.min(320, Math.max(40, asNumber(fields.height) ?? 160));
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={asString(fields.alt)}
      resizeMode="cover"
      className="w-full rounded-group bg-secondary"
      style={{ height }}
    />
  );
}
