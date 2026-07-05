// Configuration shape for the ETF dashboard.
// This is the contract shared by the data-layer (which produces per-ETF JSON
// files and writes this config) and the frontend (which loads this config via
// fetch and renders the dashboard). Keep it minimal and stable.

/**
 * One row in the config's `etfs:` array.
 *
 * `code` can be either:
 *   - a single 6-digit fund code, e.g. `"510300"`  → render as its own line
 *   - an array of 6-digit fund codes, e.g. `["510050", "510500"]`
 *     → render as a single "sum" line whose daily value is the total of
 *     every listed ETF's share count on that day. Useful for tracking the
 *     combined flow of a category (e.g. all 宽基 ETFs at once).
 */
export interface EtfRef {
  code: string | string[];
  /** Human-readable fund name. Shown verbatim in legend / tooltip. */
  name: string;
  /**
   * Optional human-readable list of underlying codes (e.g. "510050+510500"),
   * set at runtime by the chart layer when `code` is an array. Frontend-only
   * field; not present in the YAML/JSON config.
   */
  aggregatedCodes?: string[];
}

export interface ChartGroup {
  id: string;
  title: string;
  etfs: EtfRef[];
}

export interface EtfConfig {
  mainChart: {
    title: string;
    etfs: EtfRef[];
  };
  subCharts: ChartGroup[];
}

/** Per-ETF share data persisted under public/data/etfs/<code>.json. */
export interface SharePoint {
  date: string; // YYYY-MM-DD
  value: number; // in 份 (raw). Convert to 亿份 at render time.
}

export interface ChangePoint {
  date: string;
  /** Absolute change in 份. Null for the earliest entry where no prior anchor exists. */
  value: number | null;
  /** Percentage change (e.g. 0.0123 == +1.23%). Null when value is null. */
  pct: number | null;
}

export interface EtfShareData {
  code: string;
  name: string;
  shares: SharePoint[];
  dailyChange?: ChangePoint[];
  weeklyChange?: ChangePoint[];
  monthlyChange?: ChangePoint[];
  // Optional fields produced by the data-layer (real-data mode).
  quarterlyShares?: SharePoint[];
  meta?: {
    isMock: boolean;
    source?: string;
    generatedAt?: string;
  };
}

/** Index of all ETFs available under public/data/etfs/. */

// ---- v1 (legacy) shape: a flat array ----
export interface EtfIndexEntry {
  code: string;
  name: string;
  /** Optional precomputed values (v2 schema). */
  latestShares?: number;
  firstDate?: string;
  lastDate?: string;
  latestDailyChange?: number | null;
  latestWeeklyChange?: number | null;
  latestMonthlyChange?: number | null;
  isMock?: boolean;
}

// ---- v2 (current) shape: { generatedAt, source, etfs: [...] } ----
export interface EtfIndexV2 {
  generatedAt?: string;
  source?: string;
  etfs: EtfIndexEntry[];
}

export type EtfIndex = EtfIndexEntry[];
export type EtfIndexDoc = EtfIndex | EtfIndexV2;