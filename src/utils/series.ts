import type { EtfRef, SharePoint } from '../types/config';

/** Convert raw 份 → 亿份 (1 亿份 = 1e8 份). */
export function toYiShares(raw: number): number {
  return raw / 1e8;
}

export function formatYiShares(raw: number, digits = 2): string {
  return `${toYiShares(raw).toFixed(digits)} 亿份`;
}

export interface AlignedSeriesItem {
  name: string;
  /** Stable identifier per chart line. For an aggregated entry this is a
   *  "+"-joined string of underlying codes, e.g. "510050+510500". */
  code: string;
  /** When this entry aggregates multiple ETFs, the underlying codes. */
  aggregatedCodes?: string[];
  points: [string, number][];
}

export interface AlignedSeries {
  /** Sorted unique date axis. */
  dates: string[];
  /** Per-ETF series, name + value pairs indexed by dates. */
  series: AlignedSeriesItem[];
}

/**
 * Flatten an entry's `code` field into a list of underlying 6-digit codes
 * with duplicates removed (preserving first-seen order).
 *
 * Examples:
 *   "510300"           → ["510300"]
 *   ["510300", "510500"]    → ["510300", "510500"]
 *   ["510300", "510300", "510500"] → ["510300", "510500"]
 */
export function expandEntryCode(code: string | string[]): string[] {
  if (typeof code === 'string') return [code];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of code) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Build chart-ready series from entries whose `code` may be either a single
 * 6-digit string (single-line) or an array of strings (aggregated "sum of
 * these ETFs every day").
 *
 * For each entry:
 *   - Single code   → one series, value = that ETF's daily shares.
 *   - Array of codes → one series, value = SUM of every listed ETF's shares
 *     on that calendar day. Days where any underlying ETF is missing are
 *     skipped (intersection semantics — matches `alignSeries`).
 *
 * `data` is keyed by the underlying 6-digit codes (the same map you'd hand to
 * `alignSeries`). It's the caller's responsibility to have fetched each
 * underlying ETF — usually via `useEtfShares` in an Aggregator.
 *
 * Returned `AlignedSeries` is suitable to feed directly into `ShareChart`.
 */
export function aggregateEntriesSeries(
  entries: EtfRef[],
  data: Record<string, SharePoint[]>,
): AlignedSeries {
  if (entries.length === 0) return { dates: [], series: [] };

  // 1. Per-entry: which codes it aggregates + per-code date->value index.
  type EntryPlan = {
    ref: EtfRef;
    codes: string[];
    aggregatedCodes?: string[];
    /** Date -> Sum (over all listed codes) */
    sums: Map<string, number>;
    /**
     * Days for which we have *all* underlying codes' values (intersection).
     * Used to filter the final dates axis.
     */
    completeDates: Set<string>;
    /** Whether the entry has data at all (any date with full coverage). */
    hasAny: boolean;
  };

  const plans: EntryPlan[] = entries.map((ref) => {
    const codes = expandEntryCode(ref.code);
    const aggregatedCodes = codes.length > 1 ? codes : undefined;
    const indexes: Array<{ code: string; idx: Map<string, number> }> = codes.map((c) => ({
      code: c,
      idx: new Map((data[c] ?? []).map((p) => [p.date, p.value])),
    }));
    const sums = new Map<string, number>();
    const completeDates = new Set<string>();
    let hasAny = false;

    // Pick the union of dates across this entry's underlying codes: take
    // each code's full date set one by one and accumulate.
    for (const { idx } of indexes) {
      for (const [date, val] of idx) {
        const prev = sums.get(date) ?? 0;
        // Only contribute when the entry's own codes ALL have a value on
        // this date. We check completeness after this pass.
        sums.set(date, prev + val);
      }
    }
    // Compute the intersection of dates (only days where every code has data).
    if (indexes.length > 0) {
      // Seed with the first code's date set.
      let intersection = new Set<string>(indexes[0].idx.keys());
      for (let i = 1; i < indexes.length; i++) {
        const next = new Set<string>();
        for (const d of intersection) {
          if (indexes[i].idx.has(d)) next.add(d);
        }
        intersection = next;
      }
      for (const d of intersection) completeDates.add(d);
      // Restrict sums to complete dates only.
      for (const d of [...sums.keys()]) {
        if (!completeDates.has(d)) sums.delete(d);
      }
      hasAny = completeDates.size > 0;
    }

    return { ref, codes, aggregatedCodes, sums, completeDates, hasAny };
  });

  // 2. Final dates axis = intersection of every entry's completeDates.
  let dates: Set<string> = new Set();
  for (let i = 0; i < plans.length; i++) {
    const set = plans[i].completeDates;
    if (set.size === 0) {
      // If any entry has no complete dates at all, the chart is empty.
      // Bail early by returning empty.
      return { dates: [], series: [] };
    }
    if (i === 0) {
      dates = new Set(set);
    } else {
      const next = new Set<string>();
      for (const d of dates) {
        if (set.has(d)) next.add(d);
      }
      dates = next;
    }
  }

  const sortedDates: string[] = [...dates].sort();
  const series: AlignedSeriesItem[] = plans.map(({ ref, codes, aggregatedCodes, sums }) => {
    const syntheticCode =
      codes.length === 1 ? codes[0] : codes.join('+');
    const points: [string, number][] = sortedDates.map((d) => [d, sums.get(d) ?? 0]);
    return { name: ref.name, code: syntheticCode, aggregatedCodes, points };
  });

  return { dates: sortedDates, series };
}

/**
 * Output of {@link normalizeSeriesByBaseline} — same shape as
 * `AlignedSeriesItem`, but every `points` value is a percentage change
 * relative to a per-series baseline (default: the first non-zero value on
 * the shared date axis).
 *
 * `originalPoints` retains the raw 亿份 values so a renderer can show actual
 * numbers in the tooltip while the y axis still reads as percentages.
 */
export interface NormalizedSeriesItem extends AlignedSeriesItem {
  /** Per-series baseline value (亿份). */
  baselineValue: number;
  /** Baseline date (YYYY-MM-DD) used for this series. */
  baselineDate: string;
  /** Raw points aligned to the shared date axis (in 亿份) for tooltip rendering. */
  originalPoints: [string, number][];
}

export interface NormalizedSeries {
  dates: string[];
  series: NormalizedSeriesItem[];
}

/**
 * Re-align each series as a percentage change from its own baseline day.
 *
 * Why this exists: when ETF share counts are on very different absolute
 * scales (e.g. 50亿 vs 1500亿) plotting them on a single linear yAxis
 * collapses the small one. This helper maps every series into a common
 * percentage space, so the chart can keep a single linear `+0%` axis and
 * still let users compare relative movements.
 *
 * Baseline choice: the **first date on the shared `dates` axis** where the
 * series has a positive value. This is intuitive ("change since I started
 * watching"). Aggregated entries (list-type `code`) use the first sum
 * value above 0 from their underlying codes.
 *
 * If a series has no positive value, its baseline falls back to 1 so the
 * percentage math stays finite (and the line just shows +0% throughout).
 */
export function normalizeSeriesByBaseline(
  aligned: AlignedSeries,
  options: { baselineDate?: string } = {},
): NormalizedSeries {
  const { dates, series } = aligned;
  if (dates.length === 0 || series.length === 0) {
    return { dates, series: [] };
  }

  const baselineDate = options.baselineDate ?? dates[0];

  const out: NormalizedSeriesItem[] = series.map((s) => {
    // Look up baseline value: prefer the explicit baselineDate, else first
    // strictly positive value on the dates axis.
    let baselineValue = 0;
    let chosenBaselineDate = baselineDate;
    const baselinePoint = s.points.find(([d]) => d === baselineDate);
    if (baselinePoint && baselinePoint[1] > 0) {
      baselineValue = baselinePoint[1];
    } else {
      for (const [d, v] of s.points) {
        if (v > 0) {
          baselineValue = v;
          chosenBaselineDate = d;
          break;
        }
      }
    }
    if (baselineValue <= 0) baselineValue = 1; // avoid divide-by-zero

    const points: [string, number][] = s.points.map(([d, v]) => [
      d,
      ((v - baselineValue) / baselineValue) * 100,
    ]);

    return {
      name: s.name,
      code: s.code,
      aggregatedCodes: s.aggregatedCodes,
      points,
      baselineValue,
      baselineDate: chosenBaselineDate,
      originalPoints: s.points.slice(),
    };
  });

  return { dates, series: out };
}