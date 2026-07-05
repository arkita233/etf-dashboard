import { useEffect, useMemo, useRef } from 'react';
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
import { aggregateEntriesSeries, toYiShares } from '../utils/series';

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

  const { dates, series } = useMemo(() => aggregateEntriesSeries(refs, data), [refs, data]);

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

    const option = buildOption({ title, dates, series, compact });
    chart.setOption(option, true);
  }, [title, refs, series, dates, loading, compact]);

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
      ref={containerRef}
      className="share-chart"
      style={{
        width: '100%',
        height: height ? `${height}px` : `${defaultHeight}px`,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: 8,
        boxSizing: 'border-box',
      }}
    />
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
}

/**
 * Build option for the chart. Single-grid layout: all series share one xAxis
 * and (when needed) one or two yAxes. The user requirement is to overlay all
 * configured ETFs on the same chart, so we never split into N sub-grids.
 *
 * yAxis strategy:
 *   - 1 series          → 1 left yAxis
 *   - 2 series          → 1 left yAxis (both share scale)
 *   - 3+ series         → 2 yAxes (left + right); split by index, pair-adjacent.
 *
 * This keeps the chart visually "one chart" while still allowing wildly
 * different scale series to be readable.
 */
function buildOption({ title, dates, series, compact }: BuildOptionArgs): EChartsCoreOption {
  const tooltip: EChartsCoreOption['tooltip'] = {
    trigger: 'axis',
    axisPointer: { type: 'cross' },
    valueFormatter: (v: unknown) =>
      typeof v === 'number' ? `${v.toFixed(2)} 亿份` : String(v ?? '-'),
  };

  // For 3+ series we split into two yAxes (left / right) so the chart is still
  // visually a single chart while accommodating widely different scales.
  const showRightAxis = series.length >= 3;

  // Build compact "axis title" strings: list of ETF codes (short, fits the
  // margin). The full name still appears in legend/tooltip.
  //
  // Single-code entries keep showing their code on the axis; aggregated
  // entries (whose `code` is now a "+"-joined synthetic id) read more
  // clearly with the human `name` instead — the codes aren't useful on the
  // axis margin anyway.
  const buildAxisTitle = (indices: number[]): string => {
    const parts = indices.map((i) => {
      const s = series[i];
      return s.aggregatedCodes ? s.name : s.code;
    });
    return `${parts.join(' / ')}（亿份）`;
  };

  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  if (showRightAxis) {
    series.forEach((_, i) => (i % 2 === 0 ? leftIdx : rightIdx).push(i));
  } else {
    series.forEach((_, i) => leftIdx.push(i));
  }

  const yAxes: object[] = [
    {
      type: 'value',
      name: showRightAxis ? buildAxisTitle(leftIdx) : '份额（亿份）',
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: { fontSize: compact ? 10 : 11, color: '#475569' },
      position: 'left',
      axisLabel: { fontSize: compact ? 10 : 11, formatter: (v: number) => v.toFixed(0) },
      scale: true,
    },
  ];
  if (showRightAxis) {
    yAxes.push({
      type: 'value',
      name: buildAxisTitle(rightIdx),
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: { fontSize: compact ? 10 : 11, color: '#475569' },
      position: 'right',
      axisLabel: { fontSize: compact ? 10 : 11, formatter: (v: number) => v.toFixed(0) },
      scale: true,
    });
  }

  const seriesOpt: SeriesOption[] = series.map((s, i) => {
    const yAxisIndex = showRightAxis ? (i % 2) : 0;
    const color = PALETTE[i % PALETTE.length];
    const isAggregated = !!s.aggregatedCodes;
    return {
      name: s.name,
      type: 'line',
      yAxisIndex,
      data: s.points.map(([, v]) => toYiShares(v)),
      showSymbol: false,
      smooth: 0.1,
      // Aggregated-sum lines are drawn dashed so they're visually
      // distinguishable from the underlying single-ETF lines.
      lineStyle: isAggregated
        ? { width: 2, color, type: 'dashed' }
        : { width: 2, color },
      itemStyle: { color },
    };
  });

  return {
    title: { text: title, left: 12, top: 6, textStyle: { fontSize: 14 } },
    tooltip,
    legend: { top: 28, type: 'scroll' },
    grid: {
      left: 60,
      right: showRightAxis ? 70 : 30,
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