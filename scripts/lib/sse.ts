/**
 * sse.ts
 *
 * 上交所 ETF 份额数据 fetcher。
 *
 * 数据源：
 *   https://query.sse.com.cn/commonQuery.do
 *     ?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L
 *     &STAT_DATE=YYYY-MM-DD
 *
 * 返回字段：STAT_DATE / SEC_CODE / SEC_NAME / TOT_VOL / ETF_TYPE
 * TOT_VOL 单位是万份（10000 份）— 直接 ×10000 得到份数。
 *
 * 不依赖 akshare / 第三方库，仅用 fetch。
 */

import type { SharePoint } from './types.js';

const SSE_URL = 'https://query.sse.com.cn/commonQuery.do';
const SSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.sse.com.cn/',
};

const SQL_ID = 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L';

export interface SseShareRow {
  STAT_DATE: string; // YYYY-MM-DD
  SEC_CODE: string;
  SEC_NAME: string;
  TOT_VOL: string; // 万份
  ETF_TYPE: string;
}

/**
 * 拉取某一交易日所有上交所 ETF 的份额数据
 * @param date 形如 '2026-06-26'
 */
export async function fetchSseSharesForDate(
  date: string,
): Promise<SseShareRow[]> {
  const url = new URL(SSE_URL);
  url.searchParams.set('isPagination', 'true');
  url.searchParams.set('pageHelp.pageSize', '10000');
  url.searchParams.set('pageHelp.pageNo', '1');
  url.searchParams.set('pageHelp.beginPage', '1');
  url.searchParams.set('pageHelp.cacheSize', '1');
  url.searchParams.set('pageHelp.endPage', '1');
  url.searchParams.set('sqlId', SQL_ID);
  url.searchParams.set('STAT_DATE', date);

  const res = await fetch(url, { headers: SSE_HEADERS });
  if (!res.ok) {
    throw new Error(`SSE HTTP ${res.status} for ${date}`);
  }
  const json = (await res.json()) as {
    result?: SseShareRow[];
    pageHelp?: { data?: SseShareRow[] };
  };
  // SSE 接口同时返回 result 和 pageHelp.data，任一可用
  const rows = json.result ?? json.pageHelp?.data ?? [];
  return rows;
}

/**
 * 把 TOT_VOL（万份）转成 SharePoint（份）
 */
export function totVolToShares(totVol: string | number): number {
  const v = typeof totVol === 'string' ? parseFloat(totVol) : totVol;
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v * 10000; // 万份 → 份
}

/**
 * 构造过去 N 个交易日的日期列表（YYYY-MM-DD 格式，按升序）。
 * 简单做法：按日历日回溯 N 天（不剔除周末/节假日），调用方按需再过滤。
 * 实际调用时如果某天接口没数据，会得到空 rows，自然跳过。
 */
export function buildDateRange(daysBack: number, endDate?: Date): string[] {
  const end = endDate ?? new Date();
  const dates: string[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * 回溯若干交易日，给定一组 ETF 代码，返回每个 ETF 的日级份额序列。
 *
 * - 对每个日期调一次 fetchSseSharesForDate
 * - 限速：每天请求间隔 REQUEST_DELAY ms
 * - 容错：单日失败不中断整个流程
 *
 * @param codes 关注的 ETF 代码集合（字符串）
 * @param daysBack 回溯天数（含周末/节假日，调用方会按需过滤）
 * @param onProgress 进度回调 (done, total, dateStr, hitCount)
 */
export async function fetchDailyShares(
  codes: string[],
  daysBack: number,
  onProgress?: (done: number, total: number, dateStr: string, hitCount: number) => void,
): Promise<{ byCode: Map<string, SharePoint[]>; fetchedDates: string[] }> {
  const codeSet = new Set(codes);
  const dates = buildDateRange(daysBack);
  const byCode = new Map<string, SharePoint[]>();
  for (const c of codeSet) byCode.set(c, []);

  const fetchedDates: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    let rows: SseShareRow[] = [];
    try {
      rows = await fetchSseSharesForDate(date);
    } catch (e) {
      console.warn(
        `[sse] ${date} 拉取失败: ${(e as Error).message} — 跳过此日`,
      );
      onProgress?.(i + 1, dates.length, date, 0);
      continue;
    }
    let hit = 0;
    for (const row of rows) {
      if (codeSet.has(row.SEC_CODE)) {
        const shares = totVolToShares(row.TOT_VOL);
        if (shares > 0) {
          byCode.get(row.SEC_CODE)!.push({ date: row.STAT_DATE, value: shares });
          hit++;
        }
      }
    }
    if (hit > 0) fetchedDates.push(date);
    onProgress?.(i + 1, dates.length, date, hit);
    // 限速：250ms 防止触发频率限制
    await new Promise((r) => setTimeout(r, 250));
  }

  // 每个 code 内部按日期排序
  for (const arr of byCode.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  return { byCode, fetchedDates };
}


/**
 * 智能拉取：每个 ETF 单独决定起点
 *
 * 起点逻辑（per code）：
 *   - 读 existing (dateOfLastEntry)
 *   - 如果有 → 从 dateOfLastEntry + 1 天开始拉
 *   - 如果没有 → 从 daysBack 天前开始拉
 *
 * 终点：今天
 *
 * @param entries 形如 [{ code, lastDate? }, ...]
 *   lastDate: 该 code 已有数据的最后一天 (YYYY-MM-DD)，undefined = 没数据
 * @param fallbackDays 没有历史数据时，回溯多少天
 * @param endDate 默认今天
 * @param onProgress (done, total, dateStr, hitCount)
 */
export interface SmartFetchEntry {
  code: string;
  lastDate?: string; // YYYY-MM-DD
}

export async function fetchDailySharesSmart(
  entries: SmartFetchEntry[],
  fallbackDays: number,
  onProgress?: (done: number, total: number, dateStr: string, hitCount: number) => void,
  endDate?: Date,
): Promise<{ byCode: Map<string, SharePoint[]>; fetchedDates: string[] }> {
  // 为每个 code 计算独立的起止日期范围
  const end = endDate ?? new Date();
  const endStr = end.toISOString().slice(0, 10);

  // 收集所有需要拉取的日期（按 code 分组）
  const dateRangesByCode = new Map<string, { start: string; end: string }>();
  for (const e of entries) {
    let start: Date;
    if (e.lastDate) {
      // 从 lastDate 的下一天开始
      const last = new Date(e.lastDate + 'T00:00:00Z');
      start = new Date(last.getTime() + 24 * 60 * 60 * 1000);
    } else {
      start = new Date(end);
      start.setDate(start.getDate() - fallbackDays);
    }
    const startStr = start.toISOString().slice(0, 10);
    if (startStr > endStr) continue; // 已经最新，无需拉取
    dateRangesByCode.set(e.code, { start: startStr, end: endStr });
  }

  // 合并所有需要的日期到一个 Set（去重）
  const allDates = new Set<string>();
  for (const { start, end } of dateRangesByCode.values()) {
    for (let d = new Date(start + 'T00:00:00Z'); d <= new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      allDates.add(d.toISOString().slice(0, 10));
    }
  }
  const sortedDates = [...allDates].sort();

  const codeSet = new Set(entries.map((e) => e.code));
  const byCode = new Map<string, SharePoint[]>();
  for (const c of codeSet) byCode.set(c, []);

  const fetchedDates: string[] = [];
  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    let rows: SseShareRow[] = [];
    try {
      rows = await fetchSseSharesForDate(date);
    } catch (e) {
      console.warn(`[sse] ${date} 拉取失败: ${(e as Error).message} — 跳过此日`);
      onProgress?.(i + 1, sortedDates.length, date, 0);
      continue;
    }
    let hit = 0;
    for (const row of rows) {
      if (codeSet.has(row.SEC_CODE)) {
        const shares = totVolToShares(row.TOT_VOL);
        if (shares > 0) {
          byCode.get(row.SEC_CODE)!.push({ date: row.STAT_DATE, value: shares });
          hit++;
        }
      }
    }
    if (hit > 0) fetchedDates.push(date);
    onProgress?.(i + 1, sortedDates.length, date, hit);
    // 限速：250ms 防止触发频率限制
    await new Promise((r) => setTimeout(r, 250));
  }

  for (const arr of byCode.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  return { byCode, fetchedDates };
}
