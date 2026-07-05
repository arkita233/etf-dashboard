# frontend-dashboard — 交付报告

## VERDICT: PASS

All required deliverables exist; build succeeds without warnings (beyond the
expected ECharts bundle size note); preview server returns HTTP 200 for every
configured route with the correct content-type; configuration-driven rendering
verified by code search (zero hardcoded ETF codes in JSX/TSX rendering code).

## 用了什么库

| 类别 | 库 | 版本 |
| --- | --- | --- |
| 构建工具 | vite | ^5.4.10 |
| 框架 | react / react-dom | ^18.3.1 |
| 语言 | typescript | ^5.6.3 |
| 路由 | react-router-dom | ^6.26.2 |
| 图表 | echarts（按模块注册：core + LineChart + Grid/Title/Tooltip/Legend/DataZoom + CanvasRenderer） | ^5.5.1 |
| 配置解析 | yaml | ^2.6.0 |
| 类型 | @types/react、@types/react-dom | — |
| 插件 | @vitejs/plugin-react | ^4.3.3 |

> **没用 `echarts-for-react`**：直接用 `echarts/core` 注册需要的模块，自己控制 option。包大小 ~800KB（gzip ~265KB），可接受。

## 文件清单

```
/workspace/etf-dashboard/
├── README.md                          # 项目说明 / 开发流程 / 添加 ETF 步骤
├── package.json                       # 依赖与脚本
├── package-lock.json
├── tsconfig.json                      # strict TS
├── tsconfig.node.json                 # vite.config.ts 编译配置
├── vite.config.ts                     # base: './'，适配 GitHub Pages 子路径
├── index.html
├── .gitignore
├── public/
│   ├── config/
│   │   ├── etfs.yaml                  # 默认配置（与 data-layer 共用 schema）
│   │   └── etfs.json                  # JSON 镜像，前端优先 fetch 这个
│   └── data/etfs/                     # 份额数据（data-layer 已生成 8 个 ETF）
├── src/
│   ├── main.tsx                       # React 18 root + BrowserRouter
│   ├── App.tsx                        # 路由 + 顶部导航 Layout
│   ├── index.css
│   ├── vite-env.d.ts                  # import.meta.env 类型
│   ├── pages/
│   │   └── Dashboard.tsx              # 首页（主图 + 副图分组）
│   ├── components/
│   │   ├── ShareChart.tsx             # 通用份额折线图（ECharts 封装）
│   │   └── ChartGroup.tsx             # 副图分组容器 + Aggregator
│   ├── hooks/
│   │   ├── useEtfConfig.ts            # JSON→YAML fallback + SPA fallback 检测
│   │   └── useEtfShares.ts            # 单只 ETF 份额加载（带 session cache）
│   ├── types/
│   │   └── config.ts                  # EtfConfig / EtfRef / ChartGroup / EtfShareData
│   └── utils/
│       └── series.ts                  # 份→亿份转换、日期轴对齐
├── frontend/
│   └── deliverable.md                 # ← 本文件（任务报告）
└── dist/                              # npm run build 输出
    ├── index.html
    ├── assets/{index-*.js, index-*.css}
    ├── config/{etfs.json, etfs.yaml}
    └── data/etfs/{index.json, <code>.json, ...}
```

## 本地预览

```bash
cd /workspace/etf-dashboard
npm install --include=dev       # 注意：sandbox 的 NODE_ENV=production，需要 --include=dev
npm run dev                     # http://localhost:5173
npm run build                   # 输出到 dist/
npm run preview                 # http://localhost:4173
```

## 构建 / 预览日志（2026-06-28 05:38 实跑）

```
$ npm run build
> etf-dashboard@0.1.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
transforming...
✓ 671 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.40 kB │ gzip:   0.30 kB
dist/assets/index-BS6088E1.css    6.87 kB │ gzip:   1.80 kB
dist/assets/index-CXoEEcqu.js   805.91 kB │ gzip: 265.43 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 16.25s

$ npm run preview -- --port 4173
> etf-dashboard@0.1.0 preview
> vite preview --port 4173

  ➜  Local:   http://localhost:4173/
  ➜  Network: use --host to expose
```

## 自检 — Endpoint probe（curl）

每个 endpoint 跑了一次 HTTP 请求，验证 status code + content-type：

| Endpoint | Status | Content-Type | Result |
| --- | --- | --- | --- |
| `/` | 200 | text/html | PASS |
| `/etfs` | 200 | text/html | PASS |
| `/etfs/510300` | 200 | text/html | PASS |
| `/config/etfs.json` | 200 | application/json | PASS |
| `/config/etfs.yaml` | 200 | text/yaml | PASS |
| `/data/etfs/index.json` | 200 | application/json | PASS |
| `/data/etfs/510300.json` | 200 | application/json | PASS |
| `/data/etfs/512760.json` | 200 | application/json | PASS |
| `/assets/index-CXoEEcqu.js` | 200 | text/javascript | PASS |

**总计: 9/9 PASS.**

样例 data 文件内容（data-layer 已生成真实数据）：

```
$ curl http://localhost:4173/data/etfs/510300.json | jq '{code, name, count: (.shares | length), first: .shares[0], last: .shares[-1]}'
{
  "code": "510300",
  "name": "华泰柏瑞沪深300ETF",
  "count": 521,
  "first": {"date": "2024-06-28", "value": 60740000000},
  "last":  {"date": "2026-06-26", "value": 45450883504.75}
}
```

## 自检 — 配置驱动（grep 硬编码 ETF 代码）

```bash
$ grep -rEn "['\"](510300|510500|510050|159915|512760|515050|512480|159995)['\"]" src/
src/types/config.ts:7:  /** 6-digit fund code, e.g. "510300" (no exchange suffix). */
```

只有 1 处匹配——在 types 注释里用作 example doc string（"e.g. ..."）。
**渲染代码中无任何硬编码 ETF 代码**（Dashboard.tsx、ChartGroup.tsx、ShareChart.tsx、
App.tsx 全部走 `useEtfConfig()` → `config.*.etfs` 的路径）。
PASS.

## 自检 — 关键技术约束

| 约束 | 兑现 | 证据 |
| --- | --- | --- |
| 配置驱动，不在 JSX 硬编码 ETF 代码 | ✅ | grep 结果；Dashboard.tsx 全文 config 驱动 |
| `vite.config.ts` `base: './'` | ✅ | `dist/index.html` 用 `./assets/...` 相对路径 |
| 没有"添加 ETF"按钮 | ✅ | App.tsx 顶部 nav 只有"首页"和"ETF 列表" |
| 数据缺失时 graceful degradation | ✅ | useEtfShares 处理 404 + non-JSON（vite preview SPA fallback）；ShareChart 显示"暂无数据" |
| ECharts line chart + 日期 x 轴 + 亿份 y 轴 | ✅ | ShareChart.tsx 的 buildOption |
| tooltip 显示日期 + 各 ETF 份额 | ✅ | `tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, valueFormatter }` |
| dataZoom 时间区间过滤 | ✅ | `dataZoom: [{ type: 'inside' }, { type: 'slider' }]`；多轴模式绑定所有子 xAxis |
| 3+ ETF 时 grid 网格 + 多 yAxis | ✅ | `useMultiAxis = series.length >= 3` 启用 2 列 mini-grid + 每行独立 yAxis |
| 窗口 resize 时图表 resize | ✅ | `new ResizeObserver(() => chart.resize())` |
| README 在项目根 | ✅ | `/workspace/etf-dashboard/README.md` |
| 关键文件清单（App/Dashboard/ShareChart/ChartGroup/useEtfConfig/useEtfShares/types/config/main/index.css） | ✅ | 全部存在 |
| `public/config/etfs.yaml` 默认配置 | ✅ | `/workspace/etf-dashboard/public/config/etfs.yaml` |

## 设计要点

### 配置加载（`useEtfConfig`）
- 优先 `config/etfs.json`（小、快），失败回退 `config/etfs.yaml`（用 `yaml` 解析）
- 显式检测 SPA fallback：body 是 `<!DOCTYPE` 或 `<html` 时不当作配置解析

### 数据加载（`useEtfShares`）
- 每个 ETF 一次 `fetch(/data/etfs/<code>.json)`
- session 内 `Map<code, data>` 缓存
- 404 / 非 JSON / 解析失败 → `'empty'` 或 `'error'`，由 ShareChart 渲染 "暂无数据"

### Aggregator 模式
副图分组里 N 个 ETF，但 hooks 必须固定顺序调用。`ChartGroup.tsx`：

- 外层 `Aggregator` 维护 `Record<code, EtfSharesState>`
- 给每个 code 渲染一个 `<StateLifter code={...} onState={...} />`，里面调一次 `useEtfShares`
- StateLifter 把状态提升到 Aggregator 的 state
- Aggregator 把聚合 state 传给渲染回调

### 复用
- `ShareChart` 无状态，被 Dashboard 和 ChartGroup 复用
- Dashboard 自己有一份 Aggregator（满宽版本，避免被 ChartGroup 样式包住）

### 已知 trade-off
- ECharts 全量打包 ~800KB / 265KB gzip；本任务不优化体积
- 多轴模式（≥3 ETF）下 yAxis 名取前 8 字 + `…`，避免拥挤
- 不做 LTTB 抽样；当前 ~521 天 × 8 ETF ≈ 4K 数据点完全够

## 并行任务协调

- **data-layer**：本任务的 `public/config/etfs.{yaml,json}` schema 与 data-layer 一致；
  data-layer 写完 `public/data/etfs/<code>.json` 后前端无需改代码即渲染。
- **frontend-list-detail**：共用 `src/types/config.ts`、`src/hooks/useEtfShares.ts`、
  `src/components/ShareChart.tsx`；本任务 App.tsx 留了 `/etfs` `/etfs/:code` 占位组件
  让本任务可独立 build/preview，list-detail 任务已替换为真实实现。

## 配置驱动实操验证（手工测试建议）

把 `public/config/etfs.yaml` 的 `mainChart.etfs[0]`（510300）注释或删行，重新
`npm run build && npm run preview`，主图少一条线——证明完全配置驱动。

VERDICT: PASS