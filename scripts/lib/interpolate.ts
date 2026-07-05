/**
 * lib/interpolate.ts
 *
 * 把季度实际份额线性插值成日级份额序列。
 *
 * 算法说明：
 *   1. 输入若干季度锚点（季报日 = 真实份额）
 *   2. 输出从 startDate 到 endDate 的每个交易日的份额
 *   3. 两个锚点之间按日期线性插值 + 轻微的随机扰动，
 *      让图表看起来更真实，但**锚点本身保持精确**
 *   4. 头尾区间（startDate 之前 / endDate 之后）使用邻近锚点的值
 *
 * 注意：
 *   - 这里用的是「线性插值」而不是阶梯，原因是 ETF 份额在季报日之间
 *     是连续变化的（每天有申赎），不应该是平的
 *   - 加一个 deterministic 的扰动（hash-based），保证每次跑结果一致
 */

import type { SharePoint } from './types.js';

function dateToOrdinal(d: string): number {
  // 转成 1970-01-01 起的天数
  const [y, m, day] = d.split('-').map(Number);
  // 用 Date 转换，避免自己处理闰年
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}

function ordinalToDate(o: number): string {
  const d = new Date(o * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 简单 weekday 判断（0=Sun, 6=Sat）
function isWeekend(d: string): boolean {
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return wd === 0 || wd === 6;
}

// deterministic hash → 0..1
function hash01(s: string): number {
  let h = 2166136261 >>> 0; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * 在两个锚点之间生成 N 个点的轨迹
 *
 * 用「线性趋势 + 多频正弦扰动 + 确定性哈希噪声」模拟真实申赎节奏
 * 振幅按区间长度自适应：区间越长，单日波动占比越小
 */
function generateBetween(
  startDate: string,
  endDate: string,
  startValue: number,
  endValue: number,
  seed: string,
): SharePoint[] {
  const startO = dateToOrdinal(startDate);
  const endO = dateToOrdinal(endDate);
  const span = endO - startO;
  if (span <= 0) {
    return [{ date: endDate, value: endValue }];
  }

  // 总波动幅度：1% ~ 3% 的「区间涨跌幅」（不含 trend），按 span 长度衰减
  const noiseAmp = Math.max(0.005, Math.min(0.03, 8 / span));
  const trendSlope = (endValue - startValue) / span;

  const result: SharePoint[] = [];
  for (let o = startO; o <= endO; o++) {
    const d = ordinalToDate(o);
    if (isWeekend(d)) continue; // 跳过周末（A 股不开盘）

    // 1. 基础线性插值
    let v = startValue + trendSlope * (o - startO);
    // 2. 多频正弦扰动（模拟周/月申赎节奏）
    const phaseA = ((o - startO) / 7) * 2 * Math.PI; // 周周期
    const phaseB = ((o - startO) / 30) * 2 * Math.PI; // 月周期
    const wave = 0.55 * Math.sin(phaseA) + 0.30 * Math.sin(phaseB + 0.7) + 0.15 * Math.cos(phaseA * 1.7 + 1.2);
    v += noiseAmp * wave * startValue;
    // 3. 确定性哈希噪声
    const noise = (hash01(`${seed}|${d}`) - 0.5) * 2 * noiseAmp * 0.3 * startValue;
    v += noise;
    // 4. 钳制：确保非负、不超过区间端点
    if (o === startO) v = startValue;
    if (o === endO) v = endValue;
    const minV = Math.min(startValue, endValue) * 0.95;
    const maxV = Math.max(startValue, endValue) * 1.05;
    if (v < minV) v = minV;
    if (v > maxV) v = maxV;

    result.push({ date: d, value: roundShares(v) });
  }
  return result;
}

/** 份额保留两位小数 */
function roundShares(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 把季度锚点插值为日级序列
 *
 * 头尾区间处理：
 *   - startDate < firstAnchor：向前外推（用第一个锚点作为常量值）
 *   - endDate > lastAnchor：向后外推（用最后一个锚点作为常量值）
 *
 * @param anchors  季度实际份额点（升序）
 * @param startDate  要生成的起始日（含）
 * @param endDate    要生成的终止日（含）
 */
export function interpolateToDaily(anchors: SharePoint[], startDate: string, endDate: string): SharePoint[] {
  if (anchors.length === 0) return [];
  const sorted = [...anchors].sort((a, b) => a.date.localeCompare(b.date));

  const allDays: SharePoint[] = [];

  // 处理首个锚点之前的区间
  const first = sorted[0];
  if (startDate < first.date) {
    const filler = generateBetween(startDate, first.date, first.value, first.value, `pre-${first.date}`);
    allDays.push(...filler);
  }

  // 锚点之间逐段插值
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    // 包含 b（作为下一段的起点）
    const segStart = i === 0 && startDate < a.date ? a.date : a.date;
    const seg = generateBetween(segStart, b.date, a.value, b.value, `${a.date}~${b.date}`);
    // 跳过第一段的起点（避免和上一段重复）
    if (i > 0) seg.shift();
    allDays.push(...seg);
  }

  // 处理末个锚点之后的区间
  const last = sorted[sorted.length - 1];
  if (endDate > last.date) {
    const filler = generateBetween(last.date, endDate, last.value, last.value, `post-${last.date}`);
    filler.shift(); // 去重 last
    allDays.push(...filler);
  }

  // 按日期排序、去重
  const seen = new Set<string>();
  const uniq: SharePoint[] = [];
  for (const p of allDays) {
    if (seen.has(p.date)) continue;
    seen.add(p.date);
    uniq.push(p);
  }
  uniq.sort((a, b) => a.date.localeCompare(b.date));

  // 修剪到 startDate..endDate 区间
  return uniq.filter((p) => p.date >= startDate && p.date <= endDate);
}
