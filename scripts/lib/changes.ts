/**
 * lib/changes.ts
 *
 * 给定日级份额序列，计算各种尺度的变化：
 *   - daily:   shares[i] - shares[i-1]
 *   - weekly:  shares[i] - shares[i-7]
 *   - monthly: shares[i] - shares[i-30]
 *
 * 不足 N 天前的返回 value=null（首部数据点）
 */

import type { SharePoint } from './types.js';

export interface ChangePoint {
  date: string;
  value: number | null;
  /** 百分比变化（可选，方便 UI 排序时直接用） */
  pct: number | null;
}

export interface ChangeBundle {
  daily: ChangePoint[];
  weekly: ChangePoint[];
  monthly: ChangePoint[];
}

/**
 * 计算三种窗口的变化
 */
export function computeChanges(series: SharePoint[]): ChangeBundle {
  return {
    daily: computeWindow(series, 1),
    weekly: computeWindow(series, 7),
    monthly: computeWindow(series, 30),
  };
}

function computeWindow(series: SharePoint[], windowSize: number): ChangePoint[] {
  const out: ChangePoint[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < windowSize) {
      out.push({ date: series[i].date, value: null, pct: null });
      continue;
    }
    const cur = series[i].value;
    const prev = series[i - windowSize].value;
    const diff = cur - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : null;
    out.push({
      date: series[i].date,
      value: Math.round(diff * 100) / 100,
      pct: pct === null ? null : Math.round(pct * 10000) / 10000,
    });
  }
  return out;
}