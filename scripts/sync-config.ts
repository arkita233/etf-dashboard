/**
 * sync-config.ts
 *
 * 把 config/etfs.yaml 同步到 public/config/etfs.{yaml,json}，
 * 让前端能在 build 产物中读到相同的配置。
 *
 * 为什么不直接用 config/etfs.yaml：
 *   - 前端 fetch 只能访问 public/ 目录下的静态资源
 *   - 同时输出 JSON 镜像，前端加载更快（无需解析 YAML）
 *
 * 用法：
 *   npx tsx scripts/sync-config.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { validateConfig } from './validate-config.js';

function main() {
  const src = resolve(import.meta.dirname, '..', 'config/etfs.yaml');
  const outDir = resolve(import.meta.dirname, '..', 'public/config');
  mkdirSync(outDir, { recursive: true });

  // 先校验
  const result = validateConfig(src);
  if (!result.ok || !result.config) {
    console.error('[sync-config] 校验失败：');
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // YAML: 原样拷贝（保留注释友好版本）
  const yamlText = readFileSync(src, 'utf-8');
  writeFileSync(resolve(outDir, 'etfs.yaml'), yamlText, 'utf-8');

  // JSON 镜像
  const jsonText = JSON.stringify(result.config, null, 2);
  writeFileSync(resolve(outDir, 'etfs.json'), jsonText, 'utf-8');

  console.log('[sync-config] ✅ 已同步：');
  console.log(`  - ${resolve(outDir, 'etfs.yaml')}`);
  console.log(`  - ${resolve(outDir, 'etfs.json')}`);
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /sync-config\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  main();
}
