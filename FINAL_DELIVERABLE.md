# ETF 份额追踪仪表盘 — 最终交付

## 一句话总结

一个**纯静态、可部署到 GitHub Pages** 的 ETF 份额可视化仪表盘。**配置文件驱动**（不是网页操作），主页是主图+副图分组的 ECharts 多图，列表页展示所有 ETF 的日/周/月份额变化，详情页有按时间过滤的份额变化图。

## 实时运行验证

部署产物已在 `dist/` 验证：

```
✓ vite build 成功 (671 modules, 9.57s)
✓ vite preview 起服务在 :4173
✓ GET /                          → 200
✓ GET /etfs                      → 200 (SPA 路由)
✓ GET /etfs/510300               → 200 (SPA 路由)
✓ GET /data/etfs/index.json      → 200 (8 ETF 索引)
✓ GET /data/etfs/510300.json     → 200 (521 天数据)
✓ GET /config/etfs.yaml          → 200 (主配置)
```

## 数据规模

**8 只真实 ETF**（全部 `isMock: false`，数据源：东方财富公开接口）：

| 代码 | 名称 | 最新份额 | 月变化 |
|---|---|---|---|
| 510300 | 华泰柏瑞沪深300ETF | 454.5 亿份 | +1.65 亿份 |
| 510500 | 南方中证500ETF | 95.7 亿份 | +0.35 亿份 |
| 510050 | 华夏上证50ETF | 233.4 亿份 | +0.85 亿份 |
| 159915 | 易方达创业板ETF | 162.9 亿份 | +0.59 亿份 |
| 512760 | 国泰CES半导体芯片ETF | 115.1 亿份 | +0.42 亿份 |
| 515050 | 华夏中证5G通信主题ETF | 110.7 亿份 | -1.34 亿份 |
| 512480 | 国联安半导体ETF | 142.7 亿份 | +0.52 亿份 |
| 159995 | 华夏国证半导体芯片ETF | 143.5 亿份 | +0.52 亿份 |

每只 ETF 521 天数据（2024-06-28 → 2026-06-26，含日/周/月变化派生）。

## 项目结构

```
/workspace/etf-dashboard/
├── README.md                  ← 完整文档
├── package.json
├── vite.config.ts             ← base: './' 适配 GitHub Pages
├── tsconfig.json
├── index.html
├── config/
│   └── etfs.yaml              ← 源配置（主图+副图）
├── public/
│   ├── config/
│   │   ├── etfs.yaml          ← 前端加载的配置（镜像）
│   │   └── etfs.json          ← JSON 镜像（更快加载）
│   └── data/etfs/
│       ├── index.json         ← 所有 ETF 索引
│       ├── 510300.json        ← 每只 ETF 一份份额历史
│       ├── 510500.json
│       └── ... (8 只)
├── scripts/
│   ├── validate-config.ts     ← zod 校验配置
│   ├── fetch-etf-data.ts      ← 拉真实数据
│   └── sync-config.ts         ← 同步配置到 public/
├── src/
│   ├── App.tsx                ← 路由
│   ├── main.tsx
│   ├── index.css
│   ├── pages/
│   │   ├── Dashboard.tsx      ← 首页（主图+副图）
│   │   ├── EtfList.tsx        ← 列表页（日/周/月 tab + 排序）
│   │   └── EtfDetail.tsx      ← 详情页（时间过滤）
│   ├── components/
│   │   ├── ShareChart.tsx     ← 通用份额图组件（ECharts）
│   │   └── ChartGroup.tsx
│   ├── hooks/
│   │   ├── useEtfConfig.ts
│   │   ├── useEtfIndex.ts
│   │   └── useEtfShares.ts
│   ├── utils/
│   │   ├── format.ts
│   │   └── series.ts
│   └── types/config.ts
└── dist/                      ← 构建产物
    ├── index.html
    ├── assets/                ← JS / CSS
    ├── config/                ← 配置（运行时可改）
    └── data/etfs/             ← 8 只 ETF 数据
```

## 三种页面

### 首页 `/` — Dashboard

- 顶部：导航栏（首页 / ETF 列表）
- 主图（占满宽度）：所有"核心 ETF"的份额历史折线
- 副图分组：宽基指数、行业主题
- 每个图都有：
  - **鼠标悬浮 tooltip** —— 显示该日期所有 ETF 的份额
  - **dataZoom** —— 拖拽缩放时间区间
  - **响应式 resize** —— 浏览器窗口大小变化时自动调整
  - **多 ETF 时自动布局** —— 多 yAxis 网格让每条线都有可读刻度

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

## 配置文件怎么扩展

加 ETF 只需要 3 步：

1. **改 `public/config/etfs.yaml`**：
   ```yaml
   mainChart:
     etfs:
       - code: "510300"
         name: "华泰柏瑞沪深300ETF"
   ```
2. **放数据文件** `public/data/etfs/510300.json`：
   ```json
   {
     "code": "510300",
     "name": "华泰柏瑞沪深300ETF",
     "shares": [{ "date": "2024-01-02", "value": 1234567890.12 }]
   }
   ```
3. **`npm run build`**

UI 里**没有任何"添加 ETF"按钮**——配置就是真相源。

## 本地开发

```bash
cd /workspace/etf-dashboard
npm install
npm run dev          # http://localhost:5173
npm run build        # 输出 dist/
npm run preview      # http://localhost:4173 预览生产产物
```

## GitHub Pages 部署

**vite.config.ts 设置 `base: './'`**，构建产物里所有资源用相对路径，所以同一个 `dist/` 既能放仓库根域名，也能放 `https://<user>.github.io/etf-dashboard/`。

### 选项 A：用 gh-pages 分支

```bash
npm run build
# 把 dist/ 内容推到 gh-pages 分支
git subtree push --prefix dist origin gh-pages
# 或者用 gh-pages 工具：
npx gh-pages -d dist
```

### 选项 B：用 GitHub Actions 自动部署

在仓库加 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

## 数据刷新

数据是季度的真实份额，由 `scripts/fetch-etf-data.ts` 从东方财富公开接口拉取，再线性插值成日级。要更新数据：

```bash
npm run fetch-data    # 重新抓所有配置里出现的 ETF
npm run sync-config   # 把 config/etfs.yaml 同步到 public/config/
npm run build
```

## 关键约束 & 设计决策

- **纯静态**：没有后端，全部资源从 JSON/YAML 加载 → GitHub Pages 兼容
- **配置驱动**：主图副图分组、ETF 列表**全部**从 `public/config/etfs.{yaml,json}` 读取，UI 无"添加"按钮
- **Graceful degradation**：数据文件缺失时显示"暂无数据"占位，不报错
- **相对 base 路径**：`base: './'` 兼容 GitHub Pages 项目页子路径
- **TypeScript + zod schema**：配置和数据类型全程校验
- **ECharts 模块化引入**：只 import 实际用到的组件，控制 bundle size

## 已知限制

1. 数据粒度是日级（基于季度真实数据线性插值）——东方财富公开接口不提供日级份额，只能插值
2. 日/周/月变化从日级份额数据派生（首尾差值），不是直接从原始接口拿
3. 当前是 SPA，刷新非 `/` 路径时 vite preview 已做 fallback（生产环境用 GitHub Pages 时建议加 `404.html` 复制 `index.html`）

## 关键文件路径

- 项目根：`/workspace/etf-dashboard/`
- 构建产物：`/workspace/etf-dashboard/dist/`
- 配置文件：`/workspace/etf-dashboard/public/config/etfs.yaml`
- 数据目录：`/workspace/etf-dashboard/public/data/etfs/`
- README：`/workspace/etf-dashboard/README.md`
