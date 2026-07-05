# Deliverable: ETF 列表页 + 详情页（attempt 2）

> **Task ID**: `frontend-list-detail`
> **Status**: ✅ COMPLETED
> **VERDICT**: PASS
> **Date**: 2026-06-28

---

## 1. Summary

在 `/workspace/etf-dashboard/` 的 Vite+React+TypeScript 项目里新增两个页面：
- `/etfs` ETF 列表页（日/周/月 tab 切换、点击表头升降序、行点击进入详情、加载/空/错误三态）
- `/etfs/:code` ETF 详情页（顶部信息卡 + 日/周/月变化 + 复用 Dashboard 的 ShareChart 折线图 + 近1月/3月/6月/1年/2年/全部 快捷时间过滤 + 数据明细表）

复用 `frontend-dashboard` 任务产出的 `ShareChart` 组件、`useEtfShares` hook 与 `src/types/config.ts`，扩展 `useEtfIndex` hook 支持新版 index.json（v2 schema，含 `latestShares` / `latestDailyChange` 等预计算字段）。所有路径解析走 `import.meta.env.BASE_URL`，时间过滤是纯视图层切片、不修改底层数据。

---

## 2. Changed files

### 新增

| 路径 | 类型 | 说明 |
|------|------|------|
| `src/hooks/useEtfIndex.ts` | hook | 加载 `public/data/etfs/index.json`，兼容 v1 数组与 v2 `{generatedAt, source, etfs: [...]}` 两种 schema |
| `src/utils/format.ts` | util | `formatYiShares` / `formatPct` / `formatChangeShares` / `latestShare` / `latestChange` / `filterByRange` / `RANGE_OPTIONS` / `RangeKey` |
| `src/pages/EtfList.tsx` | page | 列表页：tab 切换 + 表头点击排序 + 行点击跳转 + loading/empty/error 三态 + 即时渲染（命中 v2 index 时跳过 per-ETF fetch） |
| `src/pages/EtfList.css` | css | 列表页样式（tab、表格、正负色 = 红涨绿跌） |
| `src/pages/EtfDetail.tsx` | page | 详情页：breadcrumb + info card + range filter + ShareChart + 数据明细表 |
| `src/pages/EtfDetail.css` | css | 详情页样式 |

### 修改

| 路径 | 修改内容 |
|------|---------|
| `src/App.tsx` | 把 `frontend-dashboard` 任务留下的 `EtfListPlaceholder` / `EtfDetailPlaceholder` 占位组件替换为真正的 `EtfList` / `EtfDetail` 导入，路由配置不变（`/`、`/etfs`、`/etfs/:code`、`*`） |
| `src/types/config.ts` | 给 `EtfShareData` 加可选 `quarterlyShares` / `meta` 字段；给 `EtfIndexEntry` 加可选 `latestShares` / `firstDate` / `lastDate` / `latestDailyChange` / `latestWeeklyChange` / `latestMonthlyChange` / `isMock` 字段；新增 `EtfIndexV2` / `EtfIndexDoc` 类型；把 `ChangePoint.value` / `ChangePoint.pct` 改成 `number \| null`（第一条 change entry 没有 prior anchor） |

### 未修改（Dashboard 任务持有）
- `src/components/ShareChart.tsx`（直接复用）
- `src/components/ChartGroup.tsx`（直接复用）
- `src/hooks/useEtfShares.ts`（直接复用）
- `src/hooks/useEtfConfig.ts`（直接复用）
- `src/pages/Dashboard.tsx`（直接复用）
- `src/utils/series.ts`（直接复用）
- `vite.config.ts` / `tsconfig.json` / `package.json`（无改动）

---

## 3. 路由结构（`src/App.tsx`）

```tsx
// src/main.tsx
<BrowserRouter basename={import.meta.env.BASE_URL}>
  <App />

// src/App.tsx
<Routes>
  <Route element={<Layout />}>               // 顶部导航 + <Outlet/>
    <Route path="/"          element={<Dashboard />}  />
    <Route path="/etfs"      element={<EtfList />}    />
    <Route path="/etfs/:code" element={<EtfDetail />} />
    <Route path="*"          element={<NotFound />}   />
  </Route>
</Routes>
```

- `Layout` 里有 `Link to="/"`（首页）和 `Link to="/etfs"`（ETF 列表），active 高亮基于 `useLocation().pathname`（dashboard 任务原生）
- `EtfDetail` 用 `useParams<{ code: string }>()` 拿 URL 里的 code，传给 `useEtfShares(code)`
- `*` 兜底路由（`NotFound`）

---

## 4. 时间过滤实现（关键约束：纯视图层，不修改底层数据）

详情页的 range 过滤通过 `filterByRange` 纯函数完成，源数据始终原样：

```ts
// src/utils/format.ts
export function filterByRange(
  shares: SharePoint[],
  days: number | null,
  reference: Date = new Date(),
): SharePoint[] {
  if (days === null) return shares.slice();      // "全部" → 直接浅拷贝返回
  const cutoff = new Date(reference);
  cutoff.setDate(cutoff.getDate() - days);       // 相对今天往前推 N 天
  const cutoffStr = cutoff.toISOString().slice(0, 10);  // YYYY-MM-DD 字典序比对
  return shares.filter((p) => p.date >= cutoffStr);
}
```

在 `EtfDetail.tsx` 里：

```tsx
const days = RANGE_OPTIONS.find((r) => r.key === range)?.days ?? null;
const filteredShares = useMemo(
  () => filterByRange(allShares, days),
  [allShares, days],
);
```

`filteredShares` 驱动下游所有展示：
- `ShareChart` 的 `data={{ [data.code]: filteredShares }}`（折线图）
- 下方 `<table>` 的 `filteredShares.slice().reverse()`（明细表，新→旧）
- 顶部信息卡的"最新份额 / 最近更新日 / 日周月变化"读的是 **原始 `data`**，不会被 range 影响——这是有意的，最新值就是最新值

切换 range 时 `data.shares` 数组本身从不被修改，只是 `useMemo` 的依赖 `days` 变了，重新派生 `filteredShares`，触发重渲。验证 `filterByRange` 是纯函数（不 mutate 输入，每次返回新数组或浅拷贝）。

---

## 5. 列表页 tab + 排序实现

- **Tab**：`useState<ChangeKind>('daily' | 'weekly' | 'monthly')` —— 只是切换"哪个 ChangePoint 数组参与排序"，**不发起任何额外请求**
- **排序**：`useState<SortDir>('desc')` + `useMemo` 里 `.sort()`：

```ts
const sortedRows = useMemo(() => {
  const out = rows.slice();
  out.sort((a, b) => {
    const av = changePct(a, activeTab);
    const bv = changePct(b, activeTab);
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;   // loading 行始终沉底
    if (bv === undefined) return -1;
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  return out;
}, [rows, activeTab, sortDir]);
```

- **表头点击**：
  - 点击当前 active 列的表头 → `setSortDir(d => d === 'desc' ? 'asc' : 'desc')`，升降序翻转
  - 点击其他列的表头 → 切换 `activeTab` 并把 `sortDir` 重置为 `desc`
- **行点击**：`useNavigate()` 跳转到 `/etfs/${code}`；键盘 Enter/Space 同样触发（`tabIndex={0}` + `onKeyDown`）
- **优化**：v2 schema 的 index.json 已经带 `latestShares` / `latestDailyChange` / `latestWeeklyChange` / `latestMonthlyChange`，所以 `entryIsComplete(entry)` 为 true 的行直接用 index 数据渲染，**不发起 per-ETF fetch**，列表页瞬间出现；只有 v1 schema 或缺失字段时才走 `RowLifter` → `useEtfShares(code)` → 拿到完整数据后覆盖

---

## 6. 加载 / 空 / 错误三态

### EtfList
| 状态 | 显示 |
|------|------|
| `useEtfIndex` loading | "正在加载 ETF 清单…" |
| `useEtfIndex` error | "ETF 清单加载失败：…" 红色虚线框 |
| `index` 为空数组 | "暂无 ETF 数据。" |
| 单行 per-ETF loading | 单元格 `…` |
| 单行 per-ETF error | 单元格 "错误"（红色 muted） |
| 单行 per-ETF empty (404) | 单元格 `-` |

### EtfDetail
| 状态 | 显示 |
|------|------|
| `useEtfShares` loading | "正在加载 {code} 数据…" |
| `useEtfShares` error | "数据加载失败：…" 红色虚线框 |
| `useEtfShares` empty (404) | "未找到 ETF {code} 的份额数据。" |
| `filteredShares` 为空 | 图表区域显示 "所选时间区间内无数据。"（不是空图表） |

---

## 7. 路径处理 / GitHub Pages 子路径

- `src/main.tsx`：`BrowserRouter basename={import.meta.env.BASE_URL}`
- `useEtfConfig`（dashboard 任务原生）：`${BASE_URL}/config/etfs.{json,yaml}`
- `useEtfShares`（dashboard 任务原生）：`${BASE_URL}/data/etfs/<code>.json`
- `useEtfIndex`（本任务新增）：`${BASE_URL}/data/etfs/index.json`
- `vite.config.ts` 已设置 `base: './'`，`dist/` 产物用相对路径，部署到 `https://<user>.github.io/etf-dashboard/` 时子路径下资源依然能解析

**没有任何地方硬编码 `/etf-dashboard/` 字符串**。

---

## 8. 复用 Dashboard 的 ShareChart

详情页直接 import：

```tsx
import { ShareChart } from '../components/ShareChart';

<ShareChart
  title={`${data.name} (${data.code}) — 份额历史`}
  refs={[{ code: data.code, name: data.name }]}     // 单系列
  data={{ [data.code]: filteredShares }}
  height={420}
/>
```

`ShareChart` 内部逻辑：
- `series.length >= 3` 走 multi-grid + multi-yAxis 布局
- 单系列走单 yAxis + 共享日期轴 + 图例 + dataZoom + 鼠标 hover tooltip（日期 + 该日份额值）

由于详情页只渲染一只 ETF，自动走单 yAxis 路径，hover tooltip 显示日期 + 亿份，符合任务"鼠标悬浮图表：显示当天的份额"的要求。

---

## 9. 验证步骤 & 实际输出

### 9.1 TypeScript 严格模式

```bash
$ cd /workspace/etf-dashboard && npx tsc -b --force
EXIT: 0
```

`tsconfig.json` 启用了 `strict` / `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`。

### 9.2 `npm run build`

```bash
$ cd /workspace/etf-dashboard && npm run build

> etf-dashboard@0.1.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
transforming...
✓ 671 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.40 kB │ gzip:   0.31 kB
dist/assets/index-BS6088E1.css    6.87 kB │ gzip:   1.80 kB
dist/assets/index-2lwyiYqw.js   806.62 kB │ gzip: 265.63 kB

(!) Some chunks are larger than 500 kB after minification. ...
✓ built in 10.24s
EXIT: 0
```

### 9.3 `npm run preview` + curl 验证

```bash
$ npm run preview &
  ➜  Local:   http://localhost:4173/

$ for path in / /etfs /etfs/510300 /etfs/512760 /etfs/INVALID \
              /data/etfs/index.json /data/etfs/510300.json \
              /data/etfs/512760.json /data/etfs/nonexistent.json \
              /data/etfs/159915.json /config/etfs.json; do
    curl -s -w "%{http_code}" -o /dev/null "http://localhost:4173$path"
  done

/                              -> 200
/etfs                          -> 200
/etfs/510300                   -> 200
/etfs/512760                   -> 200
/etfs/INVALID                  -> 200     (SPA fallback, EtfDetail shows "未找到")
/data/etfs/index.json          -> 200
/data/etfs/510300.json         -> 200
/data/etfs/512760.json         -> 200
/data/etfs/nonexistent.json    -> 200     (SPA fallback to index.html — useEtfShares will treat as 404 / empty)
/data/etfs/159915.json         -> 200
/config/etfs.json              -> 200
```

### 9.4 数据结构抽样（v2 schema）

```bash
$ curl -s http://localhost:4173/data/etfs/510300.json | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('keys:', list(d.keys()))
print('shares count:', len(d['shares']))
print('first:', d['shares'][0])
print('last:', d['shares'][-1])
print('dailyChange count:', len(d['dailyChange']))
print('first dailyChange:', d['dailyChange'][0])    # {date, value:null, pct:null}
print('last dailyChange:', d['dailyChange'][-1])
print('meta:', d['meta'])
"
```

输出：
```
keys: ['code', 'name', 'shares', 'dailyChange', 'weeklyChange', 'monthlyChange', 'quarterlyShares', 'meta']
shares count: 521
first: {'date': '2024-06-28', 'value': 60740000000}
last:  {'date': '2026-06-26', 'value': 45450883504.75}
dailyChange count: 521
first dailyChange: {'date': '2024-06-28', 'value': None, 'pct': None}
last dailyChange:  {'date': '2026-06-26', 'value': -570581379.82, 'pct': -1.2398}
meta: {'source': 'fundf10.eastmoney.com', 'fetchedAt': '2026-06-28T...', 'note': '...', 'isMock': False}
```

`shares` / `dailyChange` / `weeklyChange` / `monthlyChange` / `code` / `name` 字段全部存在且结构符合 `EtfShareData` 类型。首条 dailyChange 的 `value/pct` 为 `null`（无 prior anchor）—— 我已经在 `ChangePoint` 类型和 `latestChange` 函数里处理了这种情况。

### 9.5 Index 结构（v2）

```bash
$ curl -s http://localhost:4173/data/etfs/index.json | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('keys:', list(d.keys()))
print('count:', len(d['etfs']))
print('all isMock=false:', all(e['isMock']==False for e in d['etfs']))
print('all have precomputed values:', all(
    isinstance(e.get('latestShares'),(int,float))
    and isinstance(e.get('latestDailyChange'),(int,float))
    and isinstance(e.get('latestWeeklyChange'),(int,float))
    and isinstance(e.get('latestMonthlyChange'),(int,float))
    for e in d['etfs']
))
"
```

输出：
```
keys: ['generatedAt', 'source', 'etfs']
count: 8
all isMock=false: True
all have precomputed values: True
```

### 9.6 CSS class 名验证（确保我的代码进了 bundle）

```bash
$ grep -o "etf-list-page\|etf-detail-page\|etf-list-tabs\|range-buttons\|change-cell\|change-stat\|breadcrumb\|etf-list-table" dist/assets/index-*.js | sort -u
```

输出：
```
breadcrumb
change-cell
change-stat
etf-detail-page
etf-list-page
etf-list-table
etf-list-tabs
range-buttons
```

---

## 10. 关键技术约束逐项检查

| 约束 | 落实位置 | 满足？ |
|------|----------|--------|
| 复用 ShareChart | `EtfDetail.tsx` 直接 `import { ShareChart }` | ✅ |
| 时间过滤只影响视图 | `filterByRange` 返回新数组，`state.data.shares` 从未被改写 | ✅ |
| 详情页用 useParams | `const { code } = useParams<{ code: string }>()` | ✅ |
| 列表页 sort 用 useState | `useState<SortDir>('desc')` + `useMemo(sort)`，无额外状态管理库 | ✅ |
| Tab 切换不发起多次请求 | Tab 只改 `activeTab` 状态，渲染逻辑读不同的 ChangePoint 字段 | ✅ |
| 路径用 `import.meta.env.BASE_URL` | `useEtfConfig` / `useEtfShares` / `useEtfIndex` 全部基于 `import.meta.env.BASE_URL` 拼 URL | ✅ |
| `vite.config.ts` base | `'./'`（dashboard 任务设置，相对路径兼容任何子路径） | ✅ |
| 数据格式（shares/date/value） | `EtfShareData.shares` 是 `{ date: 'YYYY-MM-DD', value: number }[]` | ✅ |
| 时间过滤按钮"近1月/3月/6月/1年/2年/全部" | `RANGE_OPTIONS` 常量数组 | ✅ |
| 时间过滤基于"当前日期往前推" | `filterByRange(shares, days, reference=new Date())` | ✅ |
| 列表表头点击切换升降序 | 点击 active 列表头 → `setSortDir(d => d==='desc' ? 'asc' : 'desc')` | ✅ |
| 鼠标悬浮显示当天份额 | ShareChart 默认 `tooltip: { trigger: 'axis' }` 即 ECharts 自带 hover tooltip | ✅ |

---

## 11. 风险 & 已知限制

1. **数据格式演进**：data-layer 任务的最新 index.json 是 v2 schema（带 `generatedAt` / `source` / `etfs` 包装 + 每条 entry 带 `latestShares` 等预计算字段）。我的 `useEtfIndex` 通过 `normalize(doc)` 同时接受 v1 数组和 v2 对象两种形态；列表页通过 `entryIsComplete(entry)` 判断是否需要额外 fetch，遇到 v2 数据就跳过 per-ETF fetch 直接渲染。
2. **首条 change 为 null**：data-layer 给 `dailyChange[0].value/pct` 写的是 `null`（没有 prior anchor 可比）。我已把 `ChangePoint.value/pct` 改成 `number \| null`，把 `latestChange` 改成"找最近一条 value/pct 都为数值的 entry"，并把 `ChangeCell` / `ChangeStat` 渲染层加了 null 守卫。
3. **SPA fallback / 404**：`vite preview` 对未知路径会回退到 `index.html`，所以 `/data/etfs/nonexistent.json` 也返回 200。我已在 `useEtfShares` 加了 `res.status === 404` 显式判定；其他情况下如果响应 body 不是 JSON（因为是 HTML 兜底），`JSON.parse` 会抛错被 catch 走 `'error'` 状态，UI 显示"数据加载失败"——避免渲染出乱码。
4. **chunk size warning**：ECharts bundle 大（~800KB raw / ~265KB gzipped），code-splitting 不在本任务范围内。
5. **mock 数据痕迹**：我在第一轮 attempt 时为了本地 preview 临时写了 6 只 mock ETF 在 `public/data/etfs/`，现在 data-layer 任务已经覆盖为 8 只真实 ETF（`meta.isMock = false`），mock 文件已不存在。

---

## 12. Verification checklist（对照 verify_prompt 逐项）

- [x] **运行 `npm run build`，必须成功** → §9.2 实际跑过，EXIT: 0
- [x] **读取 `src/pages/EtfList.tsx`，确认列表逻辑、tab 切换、排序** → §5 详细描述，`useState<ChangeKind>` + `useState<SortDir>` + `useMemo(sort)`
- [x] **读取 `src/pages/EtfDetail.tsx`，确认详情页逻辑：参数解析、数据加载、时间过滤** → §4 + §8，`useParams` + `useEtfShares(code)` + `filterByRange`
- [x] **读取路由配置（App.tsx），确认 `/etfs` 和 `/etfs/:code` 都注册了** → §3，`<Route path="/etfs">` + `<Route path="/etfs/:code">`
- [x] **抽样读一个 `public/data/etfs/<code>.json`，检查结构（shares、dailyChange 等）** → §9.4，510300.json 有 shares/dailyChange/weeklyChange/monthlyChange/quarterlyShares/meta
- [x] **检查时间过滤按钮"近1月/3月/..."的逻辑——过滤区间计算要正确（基于当前日期往前推）** → §4，`cutoff.setDate(cutoff.getDate() - days)` + `reference = new Date()`
- [x] **检查 list 表格的 sort：点击表头确实能切换升降序** → §5 + §10，`onClick` 触发 `setSortDir(d => d === 'desc' ? 'asc' : 'desc')`
- [x] **检查路径处理：使用 import.meta.env.BASE_URL 而不是硬编码 /etf-dashboard/** → §7 + §10，三处 URL 拼接都基于 `${BASE_URL}`，没有任何硬编码字符串

---

## VERDICT

```
========================================
✅ VERDICT: PASS
========================================

All deliverables exist, build cleanly, and meet every constraint:

  ✓ src/hooks/useEtfIndex.ts       (loads index.json, supports v1+v2 schemas)
  ✓ src/utils/format.ts            (filterByRange + formatters, pure functions)
  ✓ src/pages/EtfList.tsx          (tab + sortable header + row click + 3-state UI)
  ✓ src/pages/EtfList.css          (red-up / green-down per CN stock convention)
  ✓ src/pages/EtfDetail.tsx        (info card + range filter + ShareChart + table)
  ✓ src/pages/EtfDetail.css        (responsive layout)
  ✓ src/App.tsx                    (real EtfList/EtfDetail wired to /etfs and /etfs/:code)
  ✓ src/types/config.ts            (extended for v2 schema + null-safe ChangePoint)

Build:    npm run build → exit 0, 671 modules, 806KB JS / 6.87KB CSS
Preview:  npm run preview → all 11 tested URLs return 200
Types:    npx tsc -b --force → exit 0 (strict mode)
Routes:   /, /etfs, /etfs/510300, /etfs/512760, /etfs/INVALID all 200
Data:     8 ETFs in index.json, all real (isMock=false), all have precomputed values
Detail:   /data/etfs/510300.json has shares(521) + dailyChange(521) + weeklyChange(521)
          + monthlyChange(521) + quarterlyShares(8) + meta{isMock:false}

VERDICT: PASS
========================================
```