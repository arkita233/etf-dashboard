import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type {
  EChartsCoreOption,
  SeriesOption,
} from 'echarts';
import type { EtfRef, SharePoint } from '../types/config';
import {
  aggregateEntriesSeries,
  minMaxNormalizeSeries,
  normalizeSeriesByBaseline,
  toYiShares,
} from '../utils/series';

/**
 * What visual scale the y axis uses. `'auto'` follows the spread heuristic
 * (linear 亿份 when series magnitudes are within 30× of each other, `% since
 * baseline` otherwise); the other three let the user pin a specific view.
 */
type ChartScale = 'minmax' | 'absolute' | 'percent';

const SCALE_BUTTONS: { key: ChartScale; label: string; title: string }[] = [
  { key: 'absolute', label: '份额', title: 'Y 轴显示亿份绝对值' },
  { key: 'percent', label: '涨跌幅%', title: 'Y 轴显示与起点的百分比变化' },
  { key: 'minmax', label: '0-1', title: 'Y 轴固定为 0–1，每条线按自己的 [最低，最高] 归一化' },
];

echarts.use([
  LineChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export interface ShareChartProps {
  title: string;
  refs: EtfRef[];
  /** map: code -> SharePoint[] (raw values in 份). */
  data: Record<string, SharePoint[]>;
  /** Optional explicit height; otherwise fills container. */
  height?: number;
  /** If true, render a tighter (single-row) variant for sub-charts. */
  compact?: boolean;
  /** Loading state — show skeleton text instead of empty chart. */
  loading?: boolean;
}

const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];

/**
 * Multi-series line chart of ETF share counts (in 亿份). Auto-responds to
 * container resize, supports tooltip with crosshair, and exposes dataZoom.
 *
 * When 3+ series are present, uses grid + multi-yAxis layout so each line has
 * its own readable scale. Otherwise a single shared yAxis is used.
 */
export function ShareChart({
  title,
  refs,
  data,
  height,
  compact = false,
  loading = false,
}: ShareChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // User-selected scale mode. Default `auto` defers to the spread heuristic
  // below. A click on the toggle bar switches to a pinned mode.
  const [scale, setScale] = useState<ChartScale>('minmax');

  const { dates, series } = useMemo(() => aggregateEntriesSeries(refs, data), [refs, data]);

  // Decide which display mode to use. We pick once per series set based on
  // the spread between the largest and smallest series' peak value. The
  // actual transformation lives in buildOption — here we just compute a
  // boolean so the effect dependency is cheap. `auto` resolves to
  // `absolute` (linear 亿份) or `percent` based on this heuristic.
  const usePercentMode = useMemo(() => computeSeriesScaleUsePercent(series), [series]);

  // Resolve the user-facing scale to one of the three render modes.
  const effectiveScale: 'absolute' | 'percent' | 'minmax' =
    scale === 'auto' ? (usePercentMode ? 'percent' : 'absolute')
      : scale === 'minmax' ? 'minmax'
        : scale;

  // Init chart instance once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Update chart when inputs change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (loading) {
      chart.clear();
      chart.setOption({ title: { text: title, left: 12, top: 8 } });
      return;
    }

    if (refs.length === 0 || series.length === 0 || dates.length === 0) {
      chart.clear();
      chart.setOption({
        title: { text: title, left: 12, top: 8 },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fill: '#94a3b8', fontSize: 16 },
        },
      });
      return;
    }

    const option = buildOption({
      title,
      dates,
      series,
      compact,
      displayMode: effectiveScale,
      baselineDate: dates[0],
    });
    chart.setOption(option, true);
  }, [title, refs, series, dates, loading, compact, effectiveScale]);

  // Re-resize on prop-driven height changes
  useEffect(() => {
    chartRef.current?.resize();
  }, [height]);

  // Default heights per chart role — main chart is taller than sub-charts:
  //   - main chart (compact=false): 560px
  //   - sub chart  (compact=true) : 420px
  const defaultHeight = compact ? 420 : 560;

  return (
    <div
      className="share-chart-wrapper"
      style={{
        position: 'relative',
        width: '100%',
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={containerRef}
        className="share-chart"
        style={{
          width: '100%',
          height: height ? `${height}px` : `${defaultHeight}px`,
        }}
      />
      {/* Scale-mode toggle, anchored top-right of the chart. */}
      <div
        className="scale-toggle"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          display: 'inline-flex',
          gap: 2,
          padding: 2,
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          fontSize: 12,
          zIndex: 2,
          backdropFilter: 'blur(4px)',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
        }}
      >
        {SCALE_BUTTONS.map((b) => {
          const active = scale === b.key;
          return (
            <button
              key={b.key}
              type="button"
              title={b.title}
              onClick={() => setScale(b.key)}
              style={{
                border: 'none',
                background: active ? '#2563eb' : 'transparent',
                color: active ? '#fff' : '#475569',
                padding: '4px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: active ? 600 : 500,
                lineHeight: 1.4,
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface BuildOptionArgs {
  title: string;
  dates: string[];
  series: {
    name: string;
    code: string;
    points: [string, number][];
    /** When this line is a sum across multiple underlying ETFs (i.e. the
     *  original entry's `code` was a list), the underlying codes. */
    aggregatedCodes?: string[];
  }[];
  compact: boolean;
  displayMode: 'absolute' | 'log' | 'percent' | 'minmax';
  baselineDate: string;
}

/**
 * Span heuristic — should the chart switch into "relative change since
 * baseline" mode?
 *
 * Returns `true` when the largest series' max value is at least
 * PERCENT_MODE_RATIO× the smallest's. In that case a single linear 亿份 axis
 * would visually crush the small series; we switch to a "% since baseline"
 * axis and let the tooltip show the real 亿份 values on hover.
 *
 * Threshold chosen so realistic ETF mixes (e.g. 科创50 ≈ 50亿  vs  沪深300
 * ≈ 1500亿  — a 30× gap) trip percent mode. Below ~30× a single linear
 * 亿份 axis reads comfortably; we keep absolute so users don't have to
 * mentally translate "%" when the data isn't actually far apart.
 */
const PERCENT_MODE_RATIO = 30;

function computeSeriesScaleUsePercent(series: BuildOptionArgs['series']): boolean {
  if (series.length < 2) return false;
  const maxes: number[] = [];
  for (const s of series) {
    let m = 0;
    for (const [, v] of s.points) if (v > m) m = v;
    if (m > 0) maxes.push(m);
  }
  if (maxes.length < 2) return false;
  const min = Math.min(...maxes);
  const max = Math.max(...maxes);
  if (min <= 0) return false;
  return max / min >= PERCENT_MODE_RATIO;
}

/**
 * Format a y-axis tick for the log display mode (kept here for future use
 * — currently auto-switched into percent mode instead of log, since
 * percent is more readable, but a caller can opt into log by setting
 * `displayMode: 'log'` explicitly).
 */
function logAxisLabelFormatter(v: number): string {
  if (!isFinite(v) || v <= 0) return '';
  if (v >= 1) return `${v.toFixed(v >= 100 ? 0 : 1)}亿份`;
  if (v >= 0.01) return `${(v * 100).toFixed(0)}千万份`;
  if (v >= 1e-4) return `${(v * 10000).toFixed(0)}万份`;
  return `${(v * 1e8).toFixed(0)}份`;
}

/**
 * Build option for the chart. Single-grid layout: all series share one xAxis
 * and (when needed) one or two yAxes. The user requirement is to overlay all
 * configured ETFs on the same chart, so we never split into N sub-grids.
 *
 * yAxis strategy (`displayMode` from caller):
 *   - 'absolute' (max/min ratio < 30×)  → linear, single 亿份 axis (1-2 series)
 *     or dual yAxis split by index parity (3+ series). Easy to read in 亿份.
 *   - 'percent'  (ratio ≥ 30×)           → linear `% since baseline` axis.
 *     Every series is normalized to its own first-day value, so wildly
 *     different absolutes collapse into a single uniform vertical scale.
 *     Tooltip still prints the *actual* 亿份 value plus the delta, so users
 *     can hover to see the truth.
 *   - 'log'      (reserved for future use) → log10 axis. Not auto-enabled
 *     now since percent mode covers the same ground more readably.
 *
 * In every mode the tooltip reveals real share counts — the transformation
 * is purely visual.
 */
function buildOption({
  title,
  dates,
  series,
  compact,
  displayMode,
  baselineDate,
}: BuildOptionArgs): EChartsCoreOption {
  // Pre-compute the per-series display payload. In absolute/log modes this
  // is just the original values (units: 亿份). In percent mode we delegate
  // to `normalizeSeriesByBaseline`. In minmax mode we delegate to
  // `minMaxNormalizeSeries` so the same helper is reusable from elsewhere
  // (e.g. exporters, tests).
  type DisplayItem = {
    name: string;
    code: string;
    aggregatedCodes?: string[];
    yData: number[];                   // what the yAxis actually plots
    originalValues: number[];          // raw 亿份 for tooltip rendering
    baselineValue?: number;            // present in percent mode
    /** Per-series [min, max] in 亿份 — present in minmax mode. */
    minValue?: number;
    maxValue?: number;
  };

  const normalized =
    displayMode === 'percent'
      ? normalizeSeriesByBaseline({ dates, series }, { baselineDate })
      : null;
  const minmaxed =
    displayMode === 'minmax'
      ? minMaxNormalizeSeries({ dates, series })
      : null;

  const display: DisplayItem[] = series.map((s, i) => {
    const yi = s.points.map(([, v]) => toYiShares(v));
    if (normalized) {
      const n = normalized.series[i];
      return {
        name: s.name,
        code: s.code,
        aggregatedCodes: s.aggregatedCodes,
        yData: n.points.map(([, v]) => v),
        originalValues: n.originalPoints.map(([, v]) => v),
        baselineValue: n.baselineValue,
      };
    }
    if (minmaxed) {
      const m = minmaxed.series[i];
      return {
        name: s.name,
        code: s.code,
        aggregatedCodes: s.aggregatedCodes,
        yData: m.points.map(([, v]) => v),
        originalValues: m.originalPoints.map(([, v]) => v),
        minValue: m.minValue,
        maxValue: m.maxValue,
      };
    }
    return {
      name: s.name,
      code: s.code,
      aggregatedCodes: s.aggregatedCodes,
      yData: yi,
      originalValues: yi,
    };
  });

  const showRightAxis =
    displayMode !== 'percent' && displayMode !== 'log' && displayMode !== 'minmax'
      && series.length >= 3;

  // Build compact "axis title" strings: list of ETF codes (short, fits the
  // margin). The full name still appears in legend/tooltip.
  const buildAxisTitle = (indices: number[]): string => {
    const parts = indices.map((i) => series[i].aggregatedCodes ? series[i].name : series[i].code);
    return `${parts.join(' / ')}`;
  };

  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  if (showRightAxis) {
    series.forEach((_, i) => (i % 2 === 0 ? leftIdx : rightIdx).push(i));
  } else {
    series.forEach((_, i) => leftIdx.push(i));
  }

  // Tooltip: in percent mode, show actual value + delta so the user can
  // hover and see the truth behind the percentage normalization. In other
  // modes the yData IS the value, so just print it with proper units.
  const tooltip: EChartsCoreOption['tooltip'] = {
    trigger: 'axis',
    axisPointer: { type: 'cross' },
    formatter: (params: unknown) => {
      const arr = Array.isArray(params) ? params : [params];
      // Axis value = category label = the date.
      const date = (arr[0] as { axisValueLabel?: unknown; axisValue?: unknown })?.axisValueLabel
        ?? (arr[0] as { axisValue?: unknown })?.axisValue
        ?? '';
      const head =
        displayMode === 'percent'
          ? `<div style="font-weight:600;margin-bottom:4px">${date}（与起点 {b0} 比较）</div>`
              .replace('{b0}', baselineDate)
          : displayMode === 'minmax'
            ? `<div style="font-weight:600;margin-bottom:4px">${date}（0-1 归一化）</div>`
            : `<div style="font-weight:600;margin-bottom:4px">${date}</div>`;
      const rows = arr
        .map((p) => {
          const pp = p as { marker?: string; seriesName?: string; dataIndex?: number };
          const idx = pp.dataIndex ?? 0;
          const item = display.find((d) => d.name === pp.seriesName);
          if (!item) return `${pp.marker ?? ''}${pp.seriesName ?? ''}: —`;
          const actual = item.originalValues[idx];
          const actualYi = actual ?? 0;
          if (displayMode === 'percent' && item.baselineValue !== undefined) {
            // baselineValue is stored in 份 (raw). Convert to 亿份 for the
            // printed baseline so the units match the rest of the tooltip.
            const baselineYi = item.baselineValue / 1e8;
            const delta = (actualYi / baselineYi - 1) * 100;
            const sign = delta > 0 ? '+' : '';
            return `${pp.marker ?? ''}${pp.seriesName ?? ''}: ${actualYi.toFixed(2)} 亿份（${sign}${delta.toFixed(2)}% vs ${baselineYi.toFixed(2)}）`;
          }
          if (displayMode === 'minmax' && item.minValue !== undefined && item.maxValue !== undefined) {
            const span = item.maxValue - item.minValue;
            const progress = span > 0 ? ((actualYi - item.minValue) / span) * 100 : 0;
            return `${pp.marker ?? ''}${pp.seriesName ?? ''}: ${actualYi.toFixed(2)} 亿份（区间 [${item.minValue.toFixed(2)}, ${item.maxValue.toFixed(2)}]，归一化 ${progress.toFixed(1)}%）`;
          }
          return `${pp.marker ?? ''}${pp.seriesName ?? ''}: ${actualYi.toFixed(2)} 亿份`;
        })
        .join('');
      return head + rows;
    },
  };

  // yAxis config — different per mode.
  const baseName =
    displayMode === 'percent'
      ? `相对起点（%）` + (showRightAxis ? '' : `\n起点 ${baselineDate}`)
      : displayMode === 'minmax'
        ? '归一化进度 (0–1)'
        : showRightAxis
          ? buildAxisTitle(leftIdx)
          : '份额（亿份）';

  const makeYAxis = (position: 'left' | 'right', name: string): object => {
    if (displayMode === 'log') {
      return {
        type: 'log',
        logBase: 10,
        name,
        nameLocation: 'middle',
        nameGap: 60,
        nameTextStyle: { fontSize: compact ? 10 : 11, color: '#475569' },
        position,
        min: 'dataMin',
        axisLabel: {
          fontSize: compact ? 10 : 11,
          formatter: (v: number) => logAxisLabelFormatter(v),
        },
      };
    }
    if (displayMode === 'percent') {
      return {
        type: 'value',
        name,
        nameLocation: 'middle',
        nameGap: 60,
        nameTextStyle: { fontSize: compact ? 10 : 11, color: '#475569' },
        position,
        axisLabel: {
          fontSize: compact ? 10 : 11,
          formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`,
        },
        // Symmetric-ish extent if data is mostly near 0; otherwise ECharts
        // picks based on data.
        scale: true,
      };
    }
    if (displayMode === 'minmax') {
      // The whole point of this mode is a fixed, comparable scale. Lock the
      // axis to [0, 1] and label the ticks as percentages of each series'
      // private [min, max] range.
      return {
        type: 'value',
        name,
        nameLocation: 'middle',
        nameGap: 60,
        nameTextStyle: { fontSize: compact ? 10 : 11, color: '#475569' },
        position,
        min: 0,
        max: 1,
        interval: 0.25,
        axisLabel: {
          fontSize: compact ? 10 : 11,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: { show: true },
      };
    }
    return {
      type: 'value',
      name,
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: { fontSize: compact ? 10 : 11, color: '#475569' },
      position,
      axisLabel: { fontSize: compact ? 10 : 11, formatter: (v: number) => v.toFixed(0) },
      scale: true,
    };
  };

  const yAxes: object[] = [makeYAxis('left', baseName)];
  if (showRightAxis) {
    yAxes.push(makeYAxis('right', buildAxisTitle(rightIdx)));
  }

  const seriesOpt: SeriesOption[] = display.map((d, i) => {
    const yAxisIndex = showRightAxis ? (i % 2) : 0;
    const color = PALETTE[i % PALETTE.length];
    return {
      name: d.name,
      type: 'line',
      yAxisIndex,
      data: d.yData,
      showSymbol: false,
      smooth: 0.1,
      // Aggregated-sum lines used to be drawn dashed so users could tell
      // them apart from the underlying single-ETF lines. They're now solid
      // (same width); only the legend + tooltip show which entries are
      // aggregated sums.
      lineStyle: { width: 2, color },
      itemStyle: { color },
    };
  });

  return {
    title: { text: title, left: 12, top: 6, textStyle: { fontSize: 14 } },
    tooltip,
    legend: { top: 28, type: 'scroll' },
    grid: {
      left: 60,
      // Reserve extra right padding in percent/minmax mode because the
      // axis-title string is longer ("归一化进度 (0–1)" / "相对起点(%)").
      right: displayMode === 'percent' || displayMode === 'minmax' ? 80 : showRightAxis ? 70 : 30,
      top: 70,
      bottom: 60,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { fontSize: compact ? 10 : 11 },
    },
    yAxis: yAxes,
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 14 }],
    series: seriesOpt,
  };
}
