# ETF 份额数据层（data-layer）

本目录描述 `etf-dashboard` 项目的**数据层**：配置 schema、ETL 脚本、数据落盘格式，
以及如何扩展（添加新 ETF）。

## 目录布局

```
etf-dashboard/
├── config/
│   └── etfs.yaml                # 单一真相源（data-layer 维护副本）
├── scripts/
│   ├── validate-config.ts       # 配置 schema 校验（zod）
│   ├── sync-config.ts           # 同步 config → public/config/
│   ├── fetch-etf-data.ts        # 数据获取主入口
│   └── lib/
│       ├── eastmoney.ts         # 东方财富公开接口封装
│       ├── interpolate.ts       # 季度 → 日级 线性插值
│       ├── changes.ts           # 日/周/月变化计算
│       ├── mock.ts              # Mock 数据生成器（fallback）
│       └── types.ts             # 共享类型
├── public/
│   ├── config/                  # 前端可读的镜像配置（sync-config 产出）
│   │   ├── etfs.yaml
│   │   └── etfs.json
│   └── data/etfs/               # 份额数据落盘目录（fetch-etf-data 产出）
│       ├── index.json
│       └── <code>.json
└── data-layer/
    └── README.md                # 本文件
```

## 技术栈

- **TypeScript 5** + **tsx**（直接跑 `.ts`，无需编译）
- **zod 4** —— 配置 schema 校验
- **yaml 2** —— YAML 解析/序列化
- **Node fetch** —— HTTP 抓取

无 Python 依赖、无数据库，纯文件落盘，方便静态托管（GitHub Pages）。

## 安装

```bash
cd etf-dashboard
npm install
```

> 注：本项目其它 dev 任务（vite、react 等）已安装；本任务只额外引入 `tsx` 和 `zod`。

## 常用命令

```bash
# 1) 校验配置文件
npm run validate-config

# 2) 把 config/etfs.yaml 同步到 public/config/（前端可访问）
npm run sync-config

# 3) 抓取真实数据（默认）
npm run fetch-data

# 4) 强制使用 mock 数据（开发/CI 用）
npm run mock-data

# 5) 一键跑完：校验 → 同步 → 抓取
npm run data:all

# 6) 抓取指定 ETF（多个用逗号分隔）
npx tsx scripts/fetch-etf-data.ts --codes 510300,510500
```

抓取成功后会输出：

```
public/data/etfs/
├── index.json        # 所有 ETF 汇总
├── 510300.json       # 单只 ETF 的份额数据
├── 510500.json
└── ...
```

## 数据源

**主数据源（真实数据）：东方财富**

| 字段 | 端点 |
|------|------|
| 季度实际份额（期末总份额） | `http://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=gmbd&mode=0&code=<code>` |
| 日级净值（参考） | `http://api.fund.eastmoney.com/f10/lsjz?fundCode=<code>&pageIndex=1&pageSize=N` |

**重要：中国 ETF 基金公开渠道只披露季度份额，不披露日级份额。**
为支撑日级图表，本任务的做法是：

1. 抓取每个 ETF 的**季度实际份额锚点**（季报日 = 真实数据）
2. 在相邻锚点之间做**线性插值 + 周期性扰动**，生成日级序列
3. 头尾区间（最早锚点之前 / 最新锚点之后）使用最近锚点作为常量
4. **锚点本身保持精确**，可以在 `quarterlyShares` 字段校验

这种做法既保证数据真实性（季度值与公开季报完全一致），又能驱动日级图表。

**Fallback 数据源（mock）**

如果某只 ETF 抓取失败（例如网络问题、该 ETF 不在 EM 数据库中），
脚本会自动回退到 `scripts/lib/mock.ts` 生成的伪数据；与此同时：

- `meta.isMock` 会被设为 `true`
- `meta.source` 会被标为 `mock-generator (fallback)`
- README 中也应当记录此事

若要**强制使用 mock**（CI / 离线开发），加 `--mock`：

```bash
npm run mock-data
```

## 数据格式

### 单只 ETF：`public/data/etfs/<code>.json`

```jsonc
{
  "code": "510300",
  "name": "华泰柏瑞沪深300ETF",
  "shares": [                       // 日级份额序列
    { "date": "2024-06-28", "value": 60740000000 },
    { "date": "2024-06-29", "value": ... }
  ],
  "dailyChange": [                  // shares[i] - shares[i-1]
    { "date": "2024-06-28", "value": null,    "pct": null },
    { "date": "2024-06-29", "value": 12345.6, "pct": 0.02 }
  ],
  "weeklyChange": [ ... ],          // shares[i] - shares[i-7]
  "monthlyChange": [ ... ],         // shares[i] - shares[i-30]
  "quarterlyShares": [              // 真实季报日份额（公开渠道原始数据）
    { "date": "2024-06-30", "value": 60740000000 },
    { "date": "2024-09-30", "value": 96922000000 }
  ],
  "meta": {
    "source": "fundf10.eastmoney.com",  // 或 "mock-generator"
    "fetchedAt": "2026-06-28T05:33:18.873Z",
    "note": "日级数据由季度实际份额线性插值得到（季报日为真实锚点）。",
    "isMock": false
  }
}
```

### 汇总：`public/data/etfs/index.json`

```jsonc
{
  "generatedAt": "2026-06-28T05:33:22Z",
  "source": "fundf10.eastmoney.com",
  "etfs": [
    {
      "code": "510300",
      "name": "华泰柏瑞沪深300ETF",
      "dataFile": "510300.json",
      "firstDate": "2024-06-28",
      "lastDate": "2026-06-26",
      "latestShares": 45450883504.75,
      "latestDailyChange": -570581379.82,
      "latestWeeklyChange": ...,
      "latestMonthlyChange": ...,
      "isMock": false
    }
  ]
}
```

## 配置文件 Schema

配置文件 `config/etfs.yaml` 由 [zod](https://zod.dev/) 严格校验。
完整 schema 定义在 [`scripts/validate-config.ts`](../scripts/validate-config.ts)。
简化版：

```yaml
mainChart:                              # 主图（必填）
  title: "核心 ETF 份额追踪"             # string, 非空
  etfs:                                  # 数组，至少 1 个
    - code: "510300"                     # 6 位数字字符串
      name: "华泰柏瑞沪深300ETF"          # string, 非空

subCharts:                              # 副图分组（可空数组）
  - id: "broad-index"                    # [a-z0-9-]+ 格式
    title: "宽基指数"                    # string, 非空
    etfs:                                # 数组，至少 1 个
      - code: "510300"
        name: "..."
```

校验规则：

- `code` 必须是 6 位数字
- `name` 不能为空
- `id` 只能包含小写字母、数字、连字符
- `title` 不能为空
- 同一 code 可在多处出现（前端会复用数据，避免重复下载）
- `id` 在所有 subChart 中必须唯一

校验失败示例（CLI 输出）：

```
[validate-config] ❌ 校验失败：
  - mainChart.title: mainChart.title 不能为空
  - mainChart.etfs: mainChart.etfs 至少包含 1 个 ETF
  - subCharts.0.id: subCharts[*].id 只能包含小写字母、数字、连字符
```

## 扩展：添加新 ETF

1. 编辑 `config/etfs.yaml`，在 `mainChart.etfs` 或某个 `subCharts[*].etfs` 追加：
   ```yaml
   - code: "512880"
     name: "国泰中证全指证券公司ETF"
   ```

2. 跑配置同步（让前端能读到新配置）：
   ```bash
   npm run sync-config
   ```

3. 跑数据抓取（生成对应 JSON 文件）：
   ```bash
   npm run fetch-data
   ```

4. （可选）跑前端构建确认图表正确：
   ```bash
   npm run build
   ```

完成后 `public/data/etfs/512880.json` 会自动生成。

## 免责声明

本项目所有数据来源于**东方财富等公开渠道**，仅供学习与研究使用，不构成任何投资建议。
数据准确性、时效性、完整性**不作保证**。请勿用于商业用途。

- 数据源 URL：`http://fundf10.eastmoney.com/` 等
- 抓取频率：建议每天 1 次（季报披露日为 3/31、6/30、9/30、12/31 后的 15 个工作日内）
- 礼貌抓取：本脚本在每只 ETF 之间 sleep 300ms，避免给数据源造成压力
