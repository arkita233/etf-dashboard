/**
 * validate-config.ts
 *
 * 校验 config/etfs.yaml 是否符合 schema。
 *
 * 使用方法：
 *   npx tsx scripts/validate-config.ts                   # 默认校验 config/etfs.yaml
 *   npx tsx scripts/validate-config.ts path/to/file.yaml # 校验指定文件
 *
 * 退出码：0 = 通过；1 = 校验失败
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ---------- JSON Schema (zod) ----------
// code 可以是单个 6 位字符串，或一组 6 位字符串（表示「合并每日份额」）
const SixDigit = z
  .string()
  .regex(/^\d{6}$/, 'code 必须是 6 位数字字符串');
const EtfEntrySchema = z.object({
  code: z
    .union([
      SixDigit,
      z
        .array(SixDigit)
        .min(1, 'code 列表至少包含 1 个 ETF'),
    ]),
  name: z.string().min(1, 'name 不能为空'),
});

// 主图：title + etfs[]
const MainChartSchema = z.object({
  title: z.string().min(1, 'mainChart.title 不能为空'),
  etfs: z.array(EtfEntrySchema).min(1, 'mainChart.etfs 至少包含 1 个 ETF'),
});

// 副图分组：id + title + etfs[]
const SubChartSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'subCharts[*].id 只能包含小写字母、数字、连字符'),
  title: z.string().min(1, 'subCharts[*].title 不能为空'),
  etfs: z.array(EtfEntrySchema).min(1, 'subCharts[*].etfs 至少包含 1 个 ETF'),
});

// 顶层配置
export const EtfConfigSchema = z.object({
  mainChart: MainChartSchema,
  subCharts: z.array(SubChartSchema).default([]),
});

export type EtfConfig = z.infer<typeof EtfConfigSchema>;

// ---------- 业务规则校验 ----------
function checkBusinessRules(config: EtfConfig, errors: string[]) {
  const seenIds = new Set<string>();
  const seenCodes = new Map<string, string[]>(); // code -> 出现的分组名

  // subChart id 必须唯一
  for (const sc of config.subCharts) {
    if (seenIds.has(sc.id)) {
      errors.push(`subCharts 中的 id "${sc.id}" 重复`);
    }
    seenIds.add(sc.id);
  }

  // code 出现在哪里记录下来，便于溯源（支持 list 类型的 code）
  const recordCode = (where: string, code: string | string[]) => {
    const codes = Array.isArray(code) ? code : [code];
    for (const c of codes) {
      const arr = seenCodes.get(c) ?? [];
      arr.push(where);
      seenCodes.set(c, arr);
    }
  };

  for (const e of config.mainChart.etfs) {
    recordCode(`mainChart(${config.mainChart.title})`, e.code);
  }
  for (const sc of config.subCharts) {
    for (const e of sc.etfs) {
      recordCode(`subChart(${sc.title})`, e.code);
    }
  }

  // 提示：同一个 ETF 出现在多个分组是允许的（前端会复用数据），
  // 但需要确保 public/data/etfs/<code>.json 存在。
  // 这里只是 info，不算 error。
  const duplicateCodes = [...seenCodes.entries()].filter(([, locs]) => locs.length > 1);
  if (duplicateCodes.length > 0) {
    console.log(
      `[info] ${duplicateCodes.length} 个 ETF 出现在多个分组（这是允许的）：`,
      duplicateCodes.map(([code, locs]) => `${code}×${locs.length}`).join(', '),
    );
  }
}

// ---------- 主函数 ----------
export function validateConfig(filePath: string): { ok: boolean; config?: EtfConfig; errors: string[] } {
  const errors: string[] = [];
  const abs = resolve(filePath);

  if (!existsSync(abs)) {
    return { ok: false, errors: [`配置文件不存在: ${abs}`] };
  }

  let raw: unknown;
  try {
    const text = readFileSync(abs, 'utf-8');
    raw = parseYaml(text);
  } catch (e) {
    return { ok: false, errors: [`YAML 解析失败: ${(e as Error).message}`] };
  }

  const result = EtfConfigSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      errors.push(`${path}: ${issue.message}`);
    }
    return { ok: false, errors };
  }

  checkBusinessRules(result.data, errors);
  return { ok: errors.length === 0, config: result.data, errors };
}

// ---------- CLI 入口 ----------
function main() {
  const arg = process.argv[2];
  const file = arg ?? resolve(import.meta.dirname, '..', 'config/etfs.yaml');

  console.log(`[validate-config] 校验: ${file}`);
  const result = validateConfig(file);

  if (!result.ok) {
    console.error('[validate-config] ❌ 校验失败：');
    for (const e of result.errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  const cfg = result.config!;
  const totalCodes = new Set<string>();
  const collect = (codes: string | string[]) => {
    for (const c of Array.isArray(codes) ? codes : [codes]) totalCodes.add(c);
  };
  for (const e of cfg.mainChart.etfs) collect(e.code);
  for (const sc of cfg.subCharts) for (const e of sc.etfs) collect(e.code);

  console.log('[validate-config] ✅ 通过');
  console.log(`  - mainChart: ${cfg.mainChart.etfs.length} 个 ETF`);
  console.log(`  - subCharts: ${cfg.subCharts.length} 个分组`);
  console.log(`  - 共 ${totalCodes.size} 个独立 ETF code`);
  process.exit(0);
}

// 当作为入口执行时运行 main；被其他模块导入时不运行
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /validate-config\.(ts|js)$/.test(process.argv[1]);
if (isMainModule) {
  main();
}
