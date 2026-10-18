// Value formatting for chart readouts and the code built-ins. Pure TypeScript, locale independent
// (Hermes Intl support varies), so the same number always renders the same string.

export type ValueFormat = 'money' | 'percent' | 'number';

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Fixed decimals with grouped thousands; trailing zeros of the fraction are dropped. */
function formatDecimal(abs: number, maxFraction: number): string {
  const [int = '0', frac = ''] = abs.toFixed(maxFraction).split('.');
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${groupThousands(int)}.${trimmed}` : groupThousands(int);
}

/** `money` -> $2,190 (cents shown only for amounts under 100), `percent` -> 12.5%, else grouped. */
export function formatValue(value: number, format?: ValueFormat): string {
  if (!Number.isFinite(value)) return '';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  switch (format) {
    case 'money':
      return `${sign}$${formatDecimal(abs, abs >= 100 ? 0 : 2)}`;
    case 'percent':
      return `${sign}${formatDecimal(abs, 1)}%`;
    default:
      return `${sign}${formatDecimal(abs, 2)}`;
  }
}
