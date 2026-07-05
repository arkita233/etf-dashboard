/**
 * fetch-etf-data.ts
 *
 * 数据获取主入口：两步流程
 *   Step 1: 从 SSE 接口拉每日全市场 ETF 份额 → 落盘 raw/daily/YYYY-MM-DD.json
 *   Step 2: 读 raw/daily/*.json + config/etfs.yaml → 切片生成 public/data/etfs/<code>.json
 *
 * 数据源（每个交易日一次 HTTP 请求，返回当日全市场 ~700 ETF 份额）：
 *   https://query.sse.com.cn/commonQuery.do
 *     ?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L
 *     &STAT_DATE=YYYY-MM-DD
 *   TOT_VOL 单位：万份（×10000 得到份数）
 *
 * 数据流（设计）：
 *   SSE 全市场 raw 数据 → 缓存层（git 跟踪，可重放）
 *   ↓
 *   按 config/etfs.yaml 切片 → public/data/etfs/<code>.json
 *
 * 优势：
 *   - 加新 ETF 只需重跑 Step 2（不重拉 raw）
 *   - 删除 ETF 同上（不重拉 raw）
 *   - 重新计算变化/排序时不需要重拉 API
 *   - 首次部署 = 一次性回填 raw 即可
 *
 * 使用方法：
 *   npx tsx scripts/fetch-etf-data.ts                 # 增量：拉新 raw + 切片
 *   npx tsx scripts/fetch-etf-data.ts --days=180      # 首次回溯 180 天
 *   npx tsx scripts/fetch-etf-data.ts --days=365      # 首次回溯 365 天
 *   npx tsx scripts/fetch-etf-data.ts --aggregate-only  # 只切片不拉数据
 *   npx tsx scripts/fetch-etf-data.ts --reset-raw       # 删 raw 重拉
 *   npx tsx scripts/fetch-etf-data.ts --mock           # 用 mock 数据替代
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from './validate-config.js';
import { fetchSseSharesForDate, totVolToShares } from './lib/sse.js';
import type { SseShareRow } from './lib/sse.js';
import { computeChanges } from './lib/changes.js';
import { generateMockData } from './lib/mock.js';
import { interpolateToDaily } from './lib/interpolate.js';
import type { SharePoint } from './lib/types.js';

// ---------- 类型 ----------
// “一个 ETF JSON 文件” 的描述。运行时 validate 返回的 config 里 entry.code
// 可能是 string 或 string[]——“合计”的语义——这里把后者展开后再用。
interface EtfEntry {
  code: string;
  name: string;
}

/** Entry.code 展平为底层 6 位 ETF 代码列表（去重、保留首次顺序）。 */
function expandEntryCode(code: string | string[]): string[] {
  const list = Array.isArray(code) ? code : [code];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/** 去重 + 保持首次出现顺序。 */
function uniqueOrdered<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

interface EtfDataFile {
  code: string;
  name: string;
  /** 日级份额序列（来自上交所每日接口，无插值） */
  shares: SharePoint[];
  dailyChange: SharePoint[];
  weeklyChange: SharePoint[];
  monthlyChange: SharePoint[];
  meta: {
    source: string;
    fetchedAt: string;
    note: string;
    isMock: boolean;
  };
}

interface IndexEntry {
  code: string;
  name: string;
  dataFile: string;
  firstDate: string;
  lastDate: string;
  latestShares: number;
}

interface RawDailyFile {
  date: string;
  fetchedAt: string;
  rows: SseShareRow[];
}

const MAX_KEEP_DAYS = 365; // 切片时只保留最近 365 天
const MAX_RAW_KEEP_DAYS = 365; // raw 也保留 365 天（避免无限增长）

// ---------- 工具 ----------
function ensureDir(dirPath: string) {
  mkdirSync(dirPath, { recursive: true });
}

function buildDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(start + 'T00:00:00Z');
    d <= new Date(end + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Step 1: Raw 数据读写 ----------
const RAW_DIR = resolve(import.meta.dirname, '..', 'public/data/raw/daily');

/**
 * 读取 compact 格式的 raw:
 *   { d: 'YYYY-MM-DD', r: [{c, n, v}, ...] }
 * 返回标准化的 RawDailyFile (用 SseShareRow 形状)
 */
function readRawDate(date: string): RawDailyFile | null {
  const p = resolve(RAW_DIR, `${date}.json`);
  if (!existsSync(p)) return null;
  try {
    const compact = JSON.parse(readFileSync(p, 'utf-8')) as { d: string; r: { c: string; n: string; v: string }[] };
    return {
      date: compact.d,
      fetchedAt: '',
      rows: compact.r.map((r) => ({
        STAT_DATE: compact.d,
        SEC_CODE: r.c,
        SEC_NAME: r.n,
        TOT_VOL: r.v,
        ETF_TYPE: '',
        NUM: '',
      })),
    };
  } catch {
    return null;
  }
}

function writeRawDate(file: RawDailyFile): void {
  ensureDir(RAW_DIR);
  const p = resolve(RAW_DIR, `${file.date}.json`);
  // 只保留切片需要的字段，去掉 date (冗余，每个 row.STAT_DATE 都有)、NUM (序号)、ETF_TYPE (没用到)
  const compactRows = file.rows.map((r) => ({
    c: r.SEC_CODE,
    n: r.SEC_NAME,
    v: r.TOT_VOL,
  }));
  writeFileSync(p, JSON.stringify({ d: file.date, r: compactRows }), 'utf-8');
}

function listRawDates(): string[] {
  if (!existsSync(RAW_DIR)) return [];
  return readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();
}

/**
 * 决定哪些 raw 日期需要拉：
 *   - 拉取范围 [start, end]
 *   - 已存在 raw 跳过
 *   - 返回缺失的日期列表
 */
function findMissingRawDates(start: string, end: string): string[] {
  const all = buildDateRange(start, end);
  const out: string[] = [];
  for (const d of all) {
    if (!readRawDate(d)) out.push(d);
  }
  return out;
}

function trimOldRaw(): number {
  if (!existsSync(RAW_DIR)) return 0;
  const dates = listRawDates();
  if (dates.length <= MAX_RAW_KEEP_DAYS) return 0;
  const toDelete = dates.slice(0, dates.length - MAX_RAW_KEEP_DAYS);
  for (const d of toDelete) {
    unlinkSync(resolve(RAW_DIR, `${d}.json`));
  }
  return toDelete.length;
}

// ---------- Step 2: 切片聚合 ----------
const ETF_DIR = resolve(import.meta.dirname, '..', 'public/data/etfs');

function readEtfJson(code: string): EtfDataFile | null {
  const p = resolve(ETF_DIR, `${code}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as EtfDataFile;
  } catch {
    return null;
  }
}

function writeEtfJson(data: EtfDataFile): void {
  ensureDir(ETF_DIR);
  const p = resolve(ETF_DIR, `${data.code}.json`);
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 从 raw 切片某只 ETF 的历史：合并 raw/daily/*.json 中所有该 code 的日期
 */
function sliceCodeFromRaw(code: string, _name: string, rawDates: string[]): SharePoint[] {
  const shares: SharePoint[] = [];
  for (const d of rawDates) {
    const raw = readRawDate(d);
    if (!raw) continue;
    const row = raw.rows.find((r) => r.SEC_CODE === code);
    if (!row) continue;
    const v = totVolToShares(row.TOT_VOL);
    if (v > 0) shares.push({ date: raw.date, value: v });
  }
  shares.sort((a, b) => a.date.localeCompare(b.date));
  return shares;
}

/**
 * 对单只 ETF：raw 切片 + 计算变化 + 裁剪到 365 天
 */
function buildEtfDataFile(code: string, name: string, rawDates: string[], existing: EtfDataFile | null): EtfDataFile {
  const shares = sliceCodeFromRaw(code, name, rawDates);

  // 裁剪到最近 365 天
  const beforeTrim = shares.length;
  const trimmed = shares.length > MAX_KEEP_DAYS ? shares.slice(-MAX_KEEP_DAYS) : shares;
  if (trimmed.length < beforeTrim) {
    console.log(`  ${code}: 裁剪 ${beforeTrim - trimmed.length} 日保留最近 ${MAX_KEEP_DAYS} 天`);
  }

  if (trimmed.length === 0) {
    // raw 里没数据，复用 existing 或给个空骨架
    if (existing && existing.shares.length > 0) {
      console.log(`  ${code}: raw 中无数据，复用 existing ${existing.shares.length} 日`);
      return existing;
    }
    return {
      code,
      name,
      shares: [],
      dailyChange: [],
      weeklyChange: [],
      monthlyChange: [],
      meta: {
        source: 'mock',
        fetchedAt: new Date().toISOString(),
        note: 'raw 数据中无此 code',
        isMock: true,
      },
    };
  }

  const { daily, weekly, monthly } = computeChanges(trimmed);
  return {
    code,
    name,
    shares: trimmed,
    dailyChange: daily,
    weeklyChange: weekly,
    monthlyChange: monthly,
    meta: {
      source: 'SSE',
      fetchedAt: new Date().toISOString(),
      note: 'real SSE API data, sliced from raw cache',
      isMock: false,
    },
  };
}

// ---------- Mock fallback（仅当完全无 raw 时用）----------
function buildMockEtfDataFile(code: string, name: string, days: number): EtfDataFile {
  const daily = generateMockData(code, name, days);
  const interpolated = interpolateToDaily(daily);
  const { daily: dailyC, weekly, monthly } = computeChanges(interpolated);
  return {
    code,
    name,
    shares: interpolated,
    dailyChange: dailyC,
    weeklyChange: weekly,
    monthlyChange: monthly,
    meta: {
      source: 'mock',
      fetchedAt: new Date().toISOString(),
      note: 'mock 数据 (raw 未拉取且无 existing)',
      isMock: true,
    },
  };
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  const useMock = args.includes('--mock');
  const aggregateOnly = args.includes('--aggregate-only');
  const resetRaw = args.includes('--reset-raw');
  const resetEtf = args.includes('--reset-etf');
  const daysArg = args.find((a) => a.startsWith('--days='));
  const daysBack = daysArg ? parseInt(daysArg.split('=')[1], 10) : 365;

  // 1. 加载并校验配置
  const configPath = resolve(import.meta.dirname, '..', 'config/etfs.yaml');
  const { config } = validateConfig(configPath);
  // An entry's `code` may be a single 6-digit string or an array; flatten
  // to the unique list of underlying codes (preserving first-seen order).
  // Aggregated entries (array code) need their underlying codes' JSON files
  // to exist — but the entry's own name is what shows on the chart.
  const allEntries = [
    ...config.mainChart.etfs,
    ...config.subCharts.flatMap((g) => g.etfs),
  ];
  const codes = uniqueOrdered(allEntries.flatMap((e) => expandEntryCode(e.code)));
  const codeToName = new Map<string, string>();
  for (const e of allEntries) {
    for (const c of expandEntryCode(e.code)) {
      if (!codeToName.has(c)) codeToName.set(c, e.name);
    }
  }
  const dupes = codes.filter((c) => [...codeToName.keys()].filter((k) => k === c).length > 1);
  if (dupes.length === 0) {
    console.log(`[info] ${codes.length} 个 ETF 来自配置（去重后）`);
  }

  // Step 1: 拉 raw 数据
  if (resetRaw) {
    if (existsSync(RAW_DIR)) {
      for (const d of listRawDates()) unlinkSync(resolve(RAW_DIR, `${d}.json`));
      console.log('[fetch-etf-data] 已清空 raw 缓存');
    }
  }

  if (!aggregateOnly) {
    const today = todayStr();
    let startDate: string;

    if (useMock) {
      console.log('[fetch-etf-data] mode=mock: 跳过 raw 拉取');
    } else {
      const existingRawDates = listRawDates();
      if (existingRawDates.length > 0) {
        // 智能增量：已有 raw 的最后一天 + 1 → 今天
        const last = existingRawDates[existingRawDates.length - 1];
        const lastDate = new Date(last + 'T00:00:00Z');
        const next = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000);
        startDate = next.toISOString().slice(0, 10);
        console.log(`[fetch-etf-data] 已有 ${existingRawDates.length} 个 raw 缓存日，最后 ${last}`);
      } else {
        // 首次：回溯 daysBack 天
        const start = new Date();
        start.setDate(start.getDate() - daysBack);
        startDate = start.toISOString().slice(0, 10);
        console.log(`[fetch-etf-data] 无 raw 缓存，回溯 ${daysBack} 天从 ${startDate} 开始`);
      }

      if (startDate > today) {
        console.log(`[fetch-etf-data] raw 已是最新（${today}），无需拉取`);
      } else {
        const missing = findMissingRawDates(startDate, today);
        console.log(`[fetch-etf-data] 范围 ${startDate} ~ ${today}，缺失 ${missing.length} 天 raw 需拉取`);

        let ok = 0;
        let fail = 0;
        for (let i = 0; i < missing.length; i++) {
          const d = missing[i];
          try {
            const rows = await fetchSseSharesForDate(d);
            if (rows.length === 0) {
              // API 当日没有数据（节假日/未更新）跳过
              if (i % 5 === 0 || i === missing.length - 1) {
                process.stdout.write(`\r  进度: ${i + 1}/${missing.length}  当前 ${d}  (空跳过)`);
              }
              continue;
            }
            writeRawDate({ date: d, fetchedAt: new Date().toISOString(), rows });
            ok++;
            if (i % 5 === 0 || i === missing.length - 1) {
              process.stdout.write(`\r  进度: ${i + 1}/${missing.length}  当前 ${d}  写入 ${rows.length} 行`);
            }
            // 限速
            await new Promise((r) => setTimeout(r, 200));
          } catch (e) {
            fail++;
            console.warn(`\n  ⚠️ ${d} 拉取失败: ${(e as Error).message}`);
          }
        }
        process.stdout.write('\n');
        console.log(`[fetch-etf-data] raw 拉取完成: 成功 ${ok} 天，失败 ${fail} 天`);
      }

      // 裁剪过期 raw
      const trimmed = trimOldRaw();
      if (trimmed > 0) {
        console.log(`[fetch-etf-data] 裁剪 ${trimmed} 个过期 raw（>${MAX_RAW_KEEP_DAYS} 天）`);
      }
    }
  }

  // Step 2: 按 config 切片
  console.log('[fetch-etf-data] === Step 2: 按配置切片 raw ===');
  const rawDates = listRawDates();
  console.log(`  raw 缓存: ${rawDates.length} 天（${rawDates[0] ?? '-'} ~ ${rawDates[rawDates.length - 1] ?? '-'}）`);

  if (resetEtf) {
    if (existsSync(ETF_DIR)) {
      for (const f of readdirSync(ETF_DIR)) {
        if (f.endsWith('.json')) unlinkSync(resolve(ETF_DIR, f));
      }
      console.log('[fetch-etf-data] 已清空 etfs 切片');
    }
  }

  const indexEntries: IndexEntry[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const code of codes) {
    const name = codeToName.get(code) ?? code;
    const existing = readEtfJson(code);

    // 如果 raw 为空且没有 existing，则用 mock
    if (rawDates.length === 0 && (!existing || existing.shares.length === 0)) {
      if (useMock) {
        console.log(`  ${code}: mock 模式，生成 ${daysBack} 天 mock`);
        const data = buildMockEtfDataFile(code, name, daysBack);
        writeEtfJson(data);
        successCount++;
        continue;
      }
      // 真实模式但无 raw 无 existing → 回退 mock 一次（首跑兜底）
      console.log(`  ${code}: 无 raw 且无 existing，回退 mock`);
      const data = buildMockEtfDataFile(code, name, daysBack);
      writeEtfJson(data);
      failCount++;
      continue;
    }

    const data = buildEtfDataFile(code, name, rawDates, existing);
    writeEtfJson(data);

    if (data.shares.length > 0) {
      const last = data.shares[data.shares.length - 1];
      indexEntries.push({
        code,
        name,
        dataFile: `${code}.json`,
        firstDate: data.shares[0]?.date ?? '',
        lastDate: last?.date ?? '',
        latestShares: last?.value ?? 0,
      });
      successCount++;
      console.log(`  ✅ ${code}: ${data.shares.length} 日 (${data.shares[0]?.date} ~ ${last?.date})`);
    } else {
      failCount++;
      console.log(`  ❌ ${code}: 无数据`);
    }
  }

  // 写 index.json
  const indexPath = resolve(ETF_DIR, 'index.json');
  writeFileSync(
    indexPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalEtfs: indexEntries.length,
        etfs: indexEntries,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`\n[fetch-etf-data] 完成: ${successCount} 成功 / ${failCount} 失败`);
  console.log(`[fetch-etf-data] 切片目录: ${ETF_DIR}`);
  console.log(`[fetch-etf-data] Raw 缓存: ${RAW_DIR} (${listRawDates().length} 天)`);
}

main().catch((e) => {
  console.error('[fetch-etf-data] 未捕获错误:', e);
  process.exit(1);
});