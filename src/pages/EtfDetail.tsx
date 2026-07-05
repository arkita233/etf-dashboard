import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ChangePoint, EtfRef, SharePoint } from '../types/config';
import { useEtfShares } from '../hooks/useEtfShares';
import { ShareChart } from '../components/ShareChart';
import {
  RANGE_OPTIONS,
  RangeKey,
  filterByRange,
  formatChangeShares,
  formatPct,
  formatYiShares,
  latestChange,
  latestShare,
} from '../utils/format';
import './EtfDetail.css';

/**
 * ETF detail page.
 *
 * Loads `data/etfs/<code>.json` via `useEtfShares`. Renders:
 *   - Info card (code, name, latest shares, latest update date)
 *   - Range filter buttons (1m/3m/6m/1y/2y/all)
 *   - ShareChart (reuses the dashboard's generic chart component, fed a
 *     single-series data map)
 *   - Data table filtered to the same range
 *
 * Time filtering is purely view-side: the underlying `shares` array is
 * untouched; we slice a derived array.
 */
export function EtfDetail() {
  const { code } = useParams<{ code: string }>();
  const state = useEtfShares(code ?? '');
  const [range, setRange] = useState<RangeKey>('3m');

  return (
    <div className="etf-detail-page">
      <nav className="breadcrumb">
        <Link to="/">首页</Link>
        <span className="sep">/</span>
        <Link to="/etfs">ETF 列表</Link>
        <span className="sep">/</span>
        <span className="current">{code ?? '?'}</span>
      </nav>

      {state.status === 'loading' && (
        <div className="etf-detail-state">正在加载 {code} 数据…</div>
      )}
      {state.status === 'error' && (
        <div className="etf-detail-state error">
          数据加载失败：{state.error}
        </div>
      )}
      {state.status === 'empty' && (
        <div className="etf-detail-state">
          未找到 ETF <code>{code}</code> 的份额数据。
        </div>
      )}
      {state.status === 'ready' && state.data && (
        <DetailBody data={state.data} range={range} setRange={setRange} />
      )}
    </div>
  );
}

interface DetailBodyProps {
  data: NonNullable<ReturnType<typeof useEtfShares>['data']>;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
}

function DetailBody({ data, range, setRange }: DetailBodyProps) {
  const allShares = data.shares;
  const latest = latestShare(allShares);
  const days = RANGE_OPTIONS.find((r) => r.key === range)?.days ?? null;
  const filteredShares = useMemo(() => filterByRange(allShares, days), [allShares, days]);

  // Feed the dashboard's ShareChart with a single-series data map.
  const refs: EtfRef[] = useMemo(
    () => [{ code: data.code, name: data.name }],
    [data.code, data.name],
  );
  const chartData: Record<string, SharePoint[]> = useMemo(
    () => ({ [data.code]: filteredShares }),
    [data.code, filteredShares],
  );

  const daily = latestChange(data, 'daily');
  const weekly = latestChange(data, 'weekly');
  const monthly = latestChange(data, 'monthly');

  // Render table in newest-first order so the most recent entries are at the
  // top — matches what readers expect on a detail page.
  const tableRows = useMemo(() => filteredShares.slice().reverse(), [filteredShares]);

  return (
    <>
      <section className="detail-info-card">
        <div className="info-row">
          <div className="info-block">
            <div className="info-label">基金代码</div>
            <div className="info-value mono">{data.code}</div>
          </div>
          <div className="info-block info-block-name">
            <div className="info-label">名称</div>
            <div className="info-value">{data.name}</div>
          </div>
          <div className="info-block">
            <div className="info-label">最新份额</div>
            <div className="info-value">
              {latest ? formatYiShares(latest.value) : '-'}
            </div>
          </div>
          <div className="info-block">
            <div className="info-label">最近更新日</div>
            <div className="info-value mono">{latest?.date ?? '-'}</div>
          </div>
        </div>
        <div className="info-row info-row-changes">
          <ChangeStat label="日变化" cp={daily} />
          <ChangeStat label="周变化" cp={weekly} />
          <ChangeStat label="月变化" cp={monthly} />
        </div>
      </section>

      <section className="detail-chart-section">
        <div className="range-buttons" role="tablist" aria-label="时间区间">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={range === opt.key}
              className={`range-btn${range === opt.key ? ' active' : ''}`}
              onClick={() => setRange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="detail-chart-wrap">
          {filteredShares.length === 0 ? (
            <div className="detail-empty-chart">所选时间区间内无数据。</div>
          ) : (
            <ShareChart
              title={`${data.name} (${data.code}) — 份额历史`}
              refs={refs}
              data={chartData}
              height={420}
            />
          )}
        </div>
      </section>

      <section className="detail-table-section">
        <h2 className="section-title">数据明细（{filteredShares.length} 条）</h2>
        <div className="detail-table-wrap">
          <table className="detail-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>份额</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p) => (
                <tr key={p.date}>
                  <td className="mono">{p.date}</td>
                  <td className="num">{formatYiShares(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ChangeStat({ label, cp }: { label: string; cp?: ChangePoint }) {
  if (!cp || cp.value === null || cp.pct === null) {
    return (
      <div className="change-stat">
        <div className="change-stat-label">{label}</div>
        <div className="change-stat-value muted">-</div>
      </div>
    );
  }
  const cls = cp.value > 0 ? 'pos' : cp.value < 0 ? 'neg' : 'flat';
  return (
    <div className={`change-stat ${cls}`}>
      <div className="change-stat-label">{label}</div>
      <div className="change-stat-value">{formatPct(cp.pct)}</div>
      <div className="change-stat-sub">{formatChangeShares(cp.value)}</div>
    </div>
  );
}