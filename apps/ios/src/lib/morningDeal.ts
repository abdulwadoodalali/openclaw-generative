// When Home plays "The Morning Deal": the first open of a local day, from 05:00. Pure TypeScript.

/** The local hour from which a new day's first open deals the brief. */
export const DEAL_FROM_HOUR = 5;

/** The local calendar day as "2026-10-13" (what is persisted as the last dealt day). */
export function dealDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** True when `now` is 05:00 or later and the brief was not dealt yet today. */
export function shouldDeal(now: Date, lastDealt: string | null): boolean {
  return now.getHours() >= DEAL_FROM_HOUR && lastDealt !== dealDay(now);
}
