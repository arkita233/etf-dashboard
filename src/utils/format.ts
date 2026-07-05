import type { ChangePoint, SharePoint } from '../types/config';

/** Convert raw 份 → 亿份 (1 亿份 = 1e8 份). */
export function toYiShares(raw: number): number {
  return raw / 1e8;
}

/** Format a raw 份 value as "X.XX 亿份". */
export function formatYiShares(raw: number, digits = 2): string {
  return `${toYiShares(raw).toFixed(digits)} 亿份`;
}

/** Format a percent as "+1.23%" / "-0.45%" / "0.00%". */
export function formatPct(pct: number, digits = 2): string {
  if (!Number.isFinite(pct)) return '-';
  const sign = pct > 0 ? '+' : pct < 0 ? '' : '';
  return `${sign}${(pct * 100).toFixed(digits)}%`;
}

/** Format a raw 份 change as a signed "±X.XX 亿份" string. */
export function formatChangeShares(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  return `${sign}${toYiShares(value).toFixed(digits)} 亿份`;
}

/**
 * Get the latest share point from a series (assumed sorted ascending by date
 * but safe against any ordering).
 */
export function latestShare(shares: SharePoint[]): SharePoint | undefined {
  if (!shares || shares.length === 0) return undefined;
  return shares.reduce((acc, p) => (acc.date >= p.date ? acc : p), shares[0]);
}

/**
 * Get the latest change point of a given kind, or undefined if not available.
 * `kind` selects which change series to read (daily/weekly/monthly).
 *
 * The data-layer's earliest entry in each change series is `{ value: null,
 * pct: null }` (no prior anchor to diff against). We walk the array in
 * reverse and return the most recent entry that actually has numeric values
 * — this matters more on the list page where the user sorts by the percent.
 */
export function latestChange(
  data:
    | {
        dailyChange?: ChangePoint[];
        weeklyChange?: ChangePoint[];
        monthlyChange?: ChangePoint[];
      }
    | undefined,
  kind: 'daily' | 'weekly' | 'monthly',
): ChangePoint | undefined {
  if (!data) return undefined;
  const arr =
    kind === 'daily'
      ? data.dailyChange
      : kind === 'weekly'
        ? data.weeklyChange
        : data.monthlyChange;
  if (!arr || arr.length === 0) return undefined;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    if (p && typeof p.value === 'number' && typeof p.pct === 'number') return p;
  }
  return undefined;
}

export type RangeKey = '1m' | '3m' | '6m' | '1y' | '2y' | 'all';

export const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1m', label: '近 1 月', days: 30 },
  { key: '3m', label: '近 3 月', days: 90 },
  { key: '6m', label: '近 6 月', days: 180 },
  { key: '1y', label: '近 1 年', days: 365 },
  { key: '2y', label: '近 2 年', days: 730 },
  { key: 'all', label: '全部', days: null },
];

/**
 * Filter share points to only those within the last `days` calendar days
 * relative to `reference` (default: now). If days is null, returns the input
 * unchanged. The reference date is treated as a local Date so timezone drift
 * doesn't push things across a day boundary unexpectedly.
 *
 * Pure function — does not mutate input.
 */
export function filterByRange(
  shares: SharePoint[],
  days: number | null,
  reference: Date = new Date(),
): SharePoint[] {
  if (days === null) return shares.slice();
  const cutoff = new Date(reference);
  cutoff.setDate(cutoff.getDate() - days);
  // Use a YYYY-MM-DD comparison so we don't accidentally drop the most
  // recent day due to hours/minutes.
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return shares.filter((p) => p.date >= cutoffStr);
}