/**
 * lib/mock.ts
 *
 * 当真实抓取失败时的 fallback：生成视觉上合理的 mock 季度份额数据。
 *
 * 特征：
 *   - 起点规模与代码 hash 相关（同 code 每次结果一致）
 *   - 整体趋势：常见 ETF 大致线性缓慢增长
 *   - 季度波动：随机扰动 ±5%
 *   - 跨年跳变：模拟季末资金流入
 *
 * 输出格式与 fetchQuarterlyShares 一致，可以无缝接入主流程。
 */

import type { SharePoint } from './types.js';

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// 简单 LCG，给定 seed 给出 0..1
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// 当前季度所有可能的季报日（A股基金季报披露规则：每个季度结束日起 15 个工作日内）
function quarterEnd(year: number, quarter: number): string {
  const map: Record<number, string> = {
    1: `${year}-03-31`,
    2: `${year}-06-30`,
    3: `${year}-09-30`,
    4: `${year}-12-31`,
  };
  return map[quarter];
}

export interface MockBundle {
  quarterlyShares: SharePoint[];
}

/**
 * 生成过去 ~3 年的季度份额锚点（最近 12 个季度）
 *
 * @param code   ETF 代码（用于确定性 seed）
 */
export function generateMockData(code: string): MockBundle {
  const rng = makeRng(hashCode(`mock-${code}`));
  const today = new Date();
  const thisYear = today.getUTCFullYear();

  // 起始规模：根据 code 派生一个"合理"的起点（亿份）
  const baseYi = 30 + (rng() * 600); // 30~630 亿份（覆盖宽基到行业）
  // 整体年化增长率
  const annualGrowth = 0.05 + rng() * 0.30; // 5%~35%

  const quarters: SharePoint[] = [];
  let valueYi = baseYi;

  // 从当前季度倒推 12 个季度
  for (let i = 0; i < 12; i++) {
    const offset = i;
    let y = thisYear;
    let q = Math.floor((today.getUTCMonth() + 1) / 3) + 1; // 当前季度
    // 倒退 offset 个季度
    let totalQ = y * 4 + (q - 1) - offset;
    y = Math.floor(totalQ / 4);
    q = (totalQ % 4) + 1;
    const dateStr = quarterEnd(y, q);
    if (dateStr > today.toISOString().slice(0, 10)) continue;

    // 季度增长率：年化分到季度，再加噪声
    const qGrowth = annualGrowth / 4 + (rng() - 0.5) * 0.06; // ±3%
    // 注意：逆序写入时要除回去
    valueYi = valueYi / (1 + qGrowth);

    // 数量级保留 1 位小数（亿份）
    const value = Math.round(valueYi * 10) / 10;
    if (value <= 0) continue;
    quarters.push({ date: dateStr, value: value * 1e8 });
  }

  quarters.sort((a, b) => a.date.localeCompare(b.date));
  return { quarterlyShares: quarters };
}
