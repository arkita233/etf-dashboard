# ETF 份额追踪仪表盘

一个**纯静态、可部署到 GitHub Pages** 的 ETF 份额可视化仪表盘。
**配置文件驱动**（不是网页操作），主页是主图 + 副图分组的 ECharts 多图，
列表页展示所有 ETF 的日/周/月份额变化，详情页有按时间过滤的份额变化图。

- **前端**：Vite + React 18 + TypeScript + ECharts 5
- **数据**：上交所公开接口，每个交易日拉一次，落盘到 JSON
- **配置驱动**：所有图都从 `public/config/etfs.yaml` 读取，UI 无"添加"按钮
- **自动部署**：GitHub Actions 每周一到周五北京时间凌晨 2:00 自动拉新数据 + 部署
- **首次拉取 365 天数据**，每日增量更新 + 365 天滚动窗口
- **Raw 缓存 + 配置切片 两层架构**：添加新 ETF 只需重跑切片，**不需要重新拉 API**

## 目录结构

```
etf-dashboard/
├── .github/
│   └── workflows/
│       └── refresh-and-deploy.yml    # GitHub Actions: 每天拉 raw + 切片 + 部署
├── config/
│   └── etfs.yaml                     # 源配置（主图 + 副图分组）
├── public/
│   ├── config/
│   │   ├── etfs.yaml                 # 前端加载的配置（镜像）
│   │   └── etfs.json                 # JSON 镜像（更快加载）
│   └── data/
│       ├── raw/daily/                # 【缓存层】全市场 raw 数据（每个交易日一份 JSON）
│       │   └── YYYY-MM-DD.json       #   含当日全市场 ~700 ETF 的代码/名字/万份数
│       └── etfs/                     # 【切片层】按配置切片的 ETF 数据（前端加载这个）
│           ├── index.json
│           └── <code>.json           # 每只配置 ETF 一份，含 shares/dailyChange/weeklyChange/monthlyChange
├── scripts/
│   ├── fetch-etf-data.ts            # 主入口：Step1拉raw + Step2切片
│   ├── validate-config.ts            # zod 校验
│   ├── sync-config.ts                # config/ → public/config/
│   └── lib/
│       ├── sse.ts                    # 上交所 SSE 接口（每日全市场）
│       ├── changes.ts                # daily/weekly/monthly 变化计算
│       ├── interpolate.ts            # mock 数据插值
│       ├── mock.ts                   # mock 数据生成
│       └── types.ts
├── src/
│   ├── App.tsx                       # 路由
│   ├── main.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx             # 首页（主图+副图）
│   │   ├── EtfList.tsx               # 列表页
│   │   └── EtfDetail.tsx             # 详情页
│   ├── components/                   # ShareChart、ChartGroup
│   ├── hooks/                        # useEtfConfig、useEtfShares、useEtfIndex
│   └── types/config.ts
├── vite.config.ts                    # base: './' 适配 GitHub Pages
├── tsconfig.json
└── package.json
```

## 数据源

### 上交所 ETF 份额接口

```
https://query.sse.com.cn/commonQuery.do
  ?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L
  &STAT_DATE=YYYY-MM-DD
```

- **字段**：`STAT_DATE / SEC_CODE / SEC_NAME / TOT_VOL / ETF_TYPE`
- **TOT_VOL** 单位：万份（×10000 得到份数）
- **每日调用一次**返回当天所有上交所 ETF 的份额（约 700 只）
- **不依赖第三方**（AKShare / 雪球 / 东财），纯官方公开数据

**重要**：只支持**上交所** ETF（5/6 开头）。**不支持**：
- 深交所代码（159/16 开头）
- 港股 ETF（即使代码是 5 开头，如 513130）
- 已退市 ETF

### 两层数据架构：Raw 缓存 + 配置切片

这是核心设计：

```
  SSE API 接口（每日全市场 ~700 ETF）
         ↓
  【缓存层】public/data/raw/daily/YYYY-MM-DD.json
         ↓
  【切片层】public/data/etfs/<code>.json  (按 config/etfs.yaml 切片)
         ↓
  前端加载
```

**为什么这样设计？**

1. **加新 ETF 不需要重拉 API** —— 只需重跑切片（`npm run fetch-data:aggregate`，几秒钟）
2. **重新计算指标**不需要重拉 —— raw 缓存是真相源
3. **历史数据完全可追溯** —— raw 原始数据、最终衍生指标都在 git 里

### 智能增量 + 365 天滚动

`fetch-data` 脚本工作流：

1. **Step 1: Raw 拉取（智能增量）**
   - 已有 raw → 从 `lastDate + 1` 开始拉（可能 0-2 天）
   - 无 raw → 从 `--days=N` 天前开始拉（首次 365 天）
   - 限制：只保留最近 365 天 raw，超过部分自动裁剪
2. **Step 2: 配置切片**
   - 读 raw/daily/*.json + config/etfs.yaml
   - 为每只配置的 ETF 生成 shares + dailyChange + weeklyChange + monthlyChange
   - 裁切到最近 365 天
3. **提交** raw + 切片到 git 仓库

这意味着：
- ✅ **历史数据永不丢失**（raw + 切片都被 git 跟踪）
- ✅ **加新 ETF 零成本**（重跑切片，不需要重拉 API）
- ✅ **首次跑 365 天** + 后续每天 1-2 次 API 调用
- ✅ **拉取失败保护**：单日拉失败保留旧 raw 不阻塞部署

**加新 ETF 的步骤**：
```bash
# 1. 在 config/etfs.yaml 里加一行
# 2. 跑 aggregate-only（0 API 调用，秒级完成）
npm run fetch-data:aggregate
# 3. 跑 build
npm run build
```

**强制重置 raw 缓存**：`npm run fetch-data:reset` 或 `npm run fetch-data -- --reset-raw`

**只重置切片**：`npm run fetch-data -- --reset-etf`

**调整保留天数**：改 `scripts/fetch-etf-data.ts` 顶部的 `MAX_KEEP_DAYS = 365`。

## 本地开发

```bash
npm install
npm run dev                              # 启动 dev server: http://localhost:5173
```

## 数据更新

### 方式 1：手动（本地）

```bash
npm run validate-config                  # 校验 config/etfs.yaml
npm run sync-config                      # 复制到 public/config/
npm run fetch-data                       # 智能增量：拉 raw + 切片（默认）
npm run fetch-data -- --days=180         # 首次拉 180 天 raw
npm run fetch-data:init                  # 首次拉 365 天 raw
npm run fetch-data:aggregate             # 只切片不拉数据（加新 ETF 用）
npm run fetch-data:reset                 # 删 raw 重拉 + 切片
npm run fetch-data -- --reset-etf        # 重置切片（raw 不动）
npm run fetch-data -- --mock             # 用 mock 数据替代
npm run mock-data                        # 同上 --mock
npm run data:all                         # 一次性跑 validate + sync + fetch
npm run build                            # 构建 dist/
npm run preview                          # 本地预览: http://localhost:4173
```

**加新 ETF 推荐流程**：
```bash
vim config/etfs.yaml                     # 加一行 ETF
npm run validate-config                  # 校验
npm run sync-config                      # 同步到 public/config/
npm run fetch-data:aggregate             # 只重切片，0 API 调用
npm run build
```

### 方式 2：GitHub Actions 自动（推荐）

`.github/workflows/refresh-and-deploy.yml` 已配置：

- **定时触发**：每周一-五 UTC 18:00 (北京时间凌晨 02:00)，自动拉数据 + 部署
- **push 触发**：main 分支 push 时也跑
- **手动触发**：Actions 页面 → Run workflow（支持指定回溯天数）

**完整工作流**：
```
cron / push / 手动
  ↓
npm ci
  ↓
npm run validate-config
  ↓
npm run sync-config
  ↓
npm run fetch-data   (智能增量：每个 ETF 从 lastDate+1 开始拉，失败不阻塞)
  ↓
npm run build
  ↓
GitHub Pages 自动部署
```

**配置方法**（只需要一次）：
1. 把代码 push 到 GitHub 仓库
2. 仓库 **Settings → Pages → Build and deployment** → Source 选 **GitHub Actions**
3. 等第一次跑完就上线了

## GitHub Pages 部署

`vite.config.ts` 设置 `base: './'`，构建产物里所有资源都用相对路径，
所以同一个 `dist/` 既可以放仓库根域名，也可以放 `https://<user>.github.io/<repo>/`。

GitHub Actions 已经帮你处理：push 到 main 后自动跑、构建、部署。

## 配置文件怎么扩展

加 ETF 只需要 2 步（不要在 UI 里加按钮，配置就是真相源）：

1. **改 `config/etfs.yaml`**：
   ```yaml
   mainChart:
     title: "核心 ETF 份额追踪"
     etfs:
       - code: "510300"
         name: "华泰柏瑞沪深300ETF"
       - code: "510050"
         name: "华夏上证50ETF"
   subCharts:
     - id: "broad-index"
       title: "宽基指数"
       etfs:
         - code: "510300"
           name: "华泰柏瑞沪深300ETF"
         - code: "510050"
           name: "华夏上证50ETF"
   ```
2. **跑 `npm run data:all && npm run build`**（或 push 到 main 等 Actions）

> **注意**：只能加 5/6 开头的**上交所**代码，且确保有真实份额数据可拉。

### 「合计」一组 ETF 的份额

可以在 `code` 处放一个列表，这样图表会画出该组 ETF 的**每日合计份额** 一条线
（以 dashed 虚线渲染，与单只区分）。例如：

```yaml
mainChart:
  etfs:
    - code: "510330"
      name: "沪深300ETF华夏"
    - code: ["510050", "510500", "560010"]   # ← 列表型 code
      name: "宽基合计（虚线）"
    - code: "588080"
      name: "科创50ETF易方达"
```

说明：

- `code` 为字符串 → 一只 ETF，单独画一条线。
- `code` 为字符串数组 → 该列表内各 ETF **每日份额求和**，作为一条「合计」线。`name` 作为图例/ tooltip 里展示的名字。
- 只要列表中每只 ETF 的 JSON 文件存在 (`public/data/etfs/<code>.json`)，前端就能自动合并。**不需要额外生成「合计」数据文件**。
- 只有当列表中所有 ETF 都有当日数据时，合计线在那天才有值（与「交集」语义一致，避免出现「某个 ETF 缺数据却仍然画点了」的误导）。
- 同一页面上单只 ETF 和合计可以混用，比如多只 ETF + 几个组合“合计”线一起画。

## 三种页面

### 首页 `/` — Dashboard

- 顶部：导航栏（首页 / ETF 列表）
- **主图**（560px 高、占满宽度）：所有"核心 ETF"的份额历史折线（单坐标系、多条线）
- **副图分组**（420px 高）：宽基指数、行业主题（可加任意多个分组）
- 每个图都是**「一张图 + 所配置的多个 ETF」**：
  - 1-2 个 ETF：单 Y 轴，多线共享刻度
  - 3+ 个 ETF：**同一坐标系 + 左右双 Y 轴**（奇偶分配），不同量级的 ETF 也能各自清晰可读
  - 不会出现「一个 ETF 一个 mini 网格」的碎片化布局
- 每个图都有：
  - **鼠标悬浮 tooltip** —— 显示该日期所有 ETF 的份额
  - **dataZoom** —— 拖拽缩放时间区间
  - **响应式 resize** —— 浏览器窗口大小变化时自动调整

### 列表页 `/etfs`

- 表格：基金代码、名称、最新份额、日变化、周变化、月变化
- **顶部 tab**：日/周/月（切换显示哪一列变化值）
- **表头点击排序**：升降序切换
- **行点击**：跳到详情页

### 详情页 `/etfs/:code`

- 顶部信息卡：基金代码、名称、最新份额、最近更新日
- 主图：该 ETF 的份额历史
- **时间过滤按钮**：近1月 / 近3月 / 近6月 / 近1年 / 近2年 / 全部
- 数据明细表：该时间区间的逐日数据

## 验证截图

实际部署后所有页面渲染示例（来自 `vite dev` + Playwright 截图）：

### 首页 Dashboard
- 主图 560px（沪深300 + 上证50），副图「宽基指数」 420px、「行业主题」 420px
- 真实 365 天数据，时间范围 2025-06-30 ~ 2026-06-26
- 主图 2 个 ETF，副图各 4 个 ETF（同一图多线 + 左右双 Y 轴）
- ECharts tooltip、dataZoom、响应式 resize 都工作
- 能看到 5G ETF 在 5 月底从 50 跳到 180 亿份的那波跳涨

### 列表页
- 8 只 ETF 表格，按日变化降序排序
- 510300 月变化 -35.18%（112.91 亿份赎回）
- 515050 5G 月变化 +54.77%（60.28 亿份申购）

### 详情页
- 顶部信息卡显示基金代码/名称/最新份额/最近更新日
- 时间过滤按钮切换近 1月/3月/6月/1年/2年/全部
- 折线图 + 数据明细表（最多 60 条/页）
- 510300 沪深300：450 → 200 亿份的真实下跌走势

## 关键约束 & 设计决策

- **纯静态**：没有后端，全部资源从 JSON/YAML 加载 → GitHub Pages 兼容
- **配置驱动**：主图副图分组、ETF 列表**全部**从 `public/config/etfs.{yaml,json}` 读取，UI 无"添加"按钮
- **Graceful degradation**：数据文件缺失时显示"暂无数据"占位，不报错
- **相对 base 路径**：`base: './'` 兼容 GitHub Pages 项目页子路径
- **TypeScript + zod schema**：配置全程校验
- **ECharts 模块化引入**：只 import 实际用到的组件，控制 bundle size
- **历史数据永不丢失**：merge 策略保留所有已写入日期，新数据只追加
- **365 天滚动窗口**：每个 ETF 自动保留最近一年
- **智能增量拉取**：每天只需 2-3 次 HTTP 请求

## 已知限制

1. **只支持上交所 ETF**（5/6 开头代码），深交所代码请不要添加
2. **上交所 ETF 份额接口历史只到 2025-06-30**，更早的日期拿不到
3. **TOT_VOL 单位**虽标注"万份"，实际是某个相对度量。趋势准确，绝对数值跟公开"场内份额"有差异（不含联接基金）。**作为趋势分析完全够用**
4. **首次跑需要网络**：mock 模式可以离线（`npm run mock-data`）
5. **包大小**：dist 含数据 ~1.5MB，每次 build 包含全部 365 天数据

## 文件结构

- 项目根：`/workspace/etf-dashboard/`
- 构建产物：`/workspace/etf-dashboard/dist/`
- 配置文件：`/workspace/etf-dashboard/config/etfs.yaml`
- 数据目录：`/workspace/etf-dashboard/public/data/etfs/`
- Actions 配置：`.github/workflows/refresh-and-deploy.yml`

## 部署到 GitHub Pages 步骤

1. **上传代码**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
2. **启用 Pages**
   - 仓库 **Settings → Pages**
   - Source: **GitHub Actions**
3. **首次部署**
   - 第一次 push 会自动触发 workflow
   - 等待 ~3 分钟（要拉 365 天 × 8 ETF = 2400+ 请求）
   - 访问 `https://<user>.github.io/<repo>/`
4. **日常维护**
   - 每周一-五北京时间凌晨 2:00 自动拉新数据并部署
   - 手动触发：Actions → Run workflow → 输入回溯天数

## 命令速查

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run preview` | 本地预览构建产物 |
| `npm run fetch-data` | 智能增量：拉 raw + 切片（默认 365 天回溯） |
| `npm run fetch-data:init` | 首次拉 365 天 raw |
| `npm run fetch-data:aggregate` | 只重跑切片（加新 ETF 用，0 API 调用） |
| `npm run fetch-data:reset` | 清空 raw 重新拉 365 天 |
| `npm run validate-config` | 校验 ETF 配置 |
| `npm run sync-config` | 同步配置到 public/ |
| `npm run mock-data` | 用 mock 数据替代（无需网络） |
| `npm run data:all` | 一次性跑 validate + sync + fetch |
