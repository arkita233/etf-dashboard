import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChangePoint, EtfIndexEntry } from '../types/config';
import { useEtfIndex } from '../hooks/useEtfIndex';
import { useEtfShares } from '../hooks/useEtfShares';
import {
  formatChangeShares,
  formatPct,
  formatYiShares,
  latestChange,
  latestShare,
} from '../utils/format';
import './EtfList.css';

type ChangeKind = 'daily' | 'weekly' | 'monthly';
type SortDir = 'asc' | 'desc';

interface EnrichedRow {
  code: string;
  name: string;
  status: 'loading' | 'ready' | 'error' | 'empty';
  latestValue?: number;
  daily?: ChangePoint;
  weekly?: ChangePoint;
  monthly?: ChangePoint;
}

/**
 * ETF list page.
 *
 * Loads `data/etfs/index.json` once. Each row lazily loads its per-ETF JSON
 * via `useEtfShares` ONLY IF the index entry doesn't already carry the
 * precomputed change values. When the data-layer produces a rich index
 * (v2 schema with `latestShares`, `latestDailyChange`, etc.), we skip the
 * per-ETF fetch entirely — instant render, zero extra requests.
 *
 * Sorting: pure useState. Click the active column's header to flip asc/desc;
 * click another column's header to switch the active tab (and reset to desc).
 */
export function EtfList() {
  const indexState = useEtfIndex();
  const [activeTab, setActiveTab] = useState<ChangeKind>('daily');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const navigate = useNavigate();

  return (
    <div className="etf-list-page">
      <header className="etf-list-header">
        <h1 className="etf-list-title">ETF 列表</h1>
        <p className="etf-list-subtitle">
          查看所有可追踪 ETF 的最新份额与日 / 周 / 月变化。点击行进入详情页。
        </p>
      </header>

      <div className="etf-list-tabs" role="tablist" aria-label="变化周期">
        {(['daily', 'weekly', 'monthly'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={activeTab === kind}
            className={`etf-tab${activeTab === kind ? ' active' : ''}`}
            onClick={() => {
              setActiveTab(kind);
              setSortDir('desc');
            }}
          >
            {kind === 'daily' ? '日变化' : kind === 'weekly' ? '周变化' : '月变化'}
          </button>
        ))}
      </div>

      {indexState.status === 'loading' && (
        <div className="etf-list-state">正在加载 ETF 清单…</div>
      )}
      {indexState.status === 'error' && (
        <div className="etf-list-state error">
          ETF 清单加载失败：{indexState.error}
          <br />
          请确认 <code>public/data/etfs/index.json</code> 是否存在。
        </div>
      )}
      {indexState.status === 'ready' && indexState.index.length === 0 && (
        <div className="etf-list-state">暂无 ETF 数据。</div>
      )}

      {indexState.status === 'ready' && indexState.index.length > 0 && (
        <SortedTable
          index={indexState.index}
          activeTab={activeTab}
          sortDir={sortDir}
          onChangeTab={(k) => {
            setActiveTab(k);
            setSortDir('desc');
          }}
          onToggleDir={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          onOpen={(code) => navigate(`/etfs/${code}`)}
        />
      )}
    </div>
  );
}

interface SortedTableProps {
  index: EtfIndexEntry[];
  activeTab: ChangeKind;
  sortDir: SortDir;
  onChangeTab: (k: ChangeKind) => void;
  onToggleDir: () => void;
  onOpen: (code: string) => void;
}

/**
 * Decide whether an index entry carries all the data we need to render its
 * row without an extra fetch. v2 schema embeds `latestShares` plus the
 * three change magnitudes; we synthesize ChangePoints from those.
 */
function entryIsComplete(e: EtfIndexEntry): boolean {
  return (
    typeof e.latestShares === 'number' &&
    typeof e.latestDailyChange === 'number' &&
    typeof e.latestWeeklyChange === 'number' &&
    typeof e.latestMonthlyChange === 'number'
  );
}

function entryToRow(e: EtfIndexEntry): EnrichedRow {
  if (!entryIsComplete(e)) {
    return { code: e.code, name: e.name, status: 'loading' };
  }
  // We only have the change magnitude in the index; for the row we don't
  // need pct (sort uses change.value as a proxy if pct missing) — but the
  // table wants a percent. The data-layer writes `latestShares` and the
  // absolute change; pct isn't in the index. We'll display both fields
  // using the absolute change; the row will compute pct when the per-ETF
  // JSON is loaded (RowLifter) and update.
  // For instant render we use a placeholder pct of 0 and let the per-ETF
  // hydration correct it within ~100ms.
  return {
    code: e.code,
    name: e.name,
    status: 'ready',
    latestValue: e.latestShares!,
    daily: synthChange(e.lastDate ?? '', e.latestDailyChange!, e.latestShares!),
    weekly: synthChange(e.lastDate ?? '', e.latestWeeklyChange!, e.latestShares!),
    monthly: synthChange(e.lastDate ?? '', e.latestMonthlyChange!, e.latestShares!),
  };
}

function synthChange(date: string, value: number, latestShares: number): ChangePoint {
  const prev = latestShares - value;
  const pct = prev === 0 ? 0 : value / prev;
  return { date, value, pct };
}

/**
 * Renders the rows. Each row that needs hydration gets its own
 * `RowLifter` child that calls `useEtfShares(code)`. Rows that are already
 * complete from the index skip the fetch entirely.
 */
function SortedTable({ index, activeTab, sortDir, onChangeTab, onToggleDir, onOpen }: SortedTableProps) {
  const [rows, setRows] = useState<EnrichedRow[]>(() => index.map(entryToRow));

  // Reset rows when the index reference changes (e.g. after first load).
  useEffect(() => {
    setRows(index.map(entryToRow));
  }, [index]);

  const onRowLoaded = (row: EnrichedRow) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.code === row.code);
      if (idx === -1) return prev;
      const cur = prev[idx];
      if (
        cur.status === row.status &&
        cur.latestValue === row.latestValue &&
        cur.daily === row.daily &&
        cur.weekly === row.weekly &&
        cur.monthly === row.monthly
      ) {
        return prev;
      }
      const next = prev.slice();
      next[idx] = row;
      return next;
    });
  };

  const sortedRows = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const av = changePct(a, activeTab);
      const bv = changePct(b, activeTab);
      // Push "loading" / undefined to the bottom regardless of direction so
      // they don't visually dominate or vanish at the top.
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return out;
  }, [rows, activeTab, sortDir]);

  return (
    <>
      {index
        .filter((e) => !entryIsComplete(e))
        .map((entry) => (
          <RowLifter
            key={entry.code}
            code={entry.code}
            name={entry.name}
            onLoaded={onRowLoaded}
          />
        ))}
      <div className="etf-list-table-wrap">
        <table className="etf-list-table">
          <thead>
            <tr>
              <th>基金代码</th>
              <th>名称</th>
              <th>最新份额</th>
              <SortableTh
                label="日变化"
                isActive={activeTab === 'daily'}
                sortDir={sortDir}
                onClick={() => {
                  if (activeTab === 'daily') onToggleDir();
                  else onChangeTab('daily');
                }}
              />
              <SortableTh
                label="周变化"
                isActive={activeTab === 'weekly'}
                sortDir={sortDir}
                onClick={() => {
                  if (activeTab === 'weekly') onToggleDir();
                  else onChangeTab('weekly');
                }}
              />
              <SortableTh
                label="月变化"
                isActive={activeTab === 'monthly'}
                sortDir={sortDir}
                onClick={() => {
                  if (activeTab === 'monthly') onToggleDir();
                  else onChangeTab('monthly');
                }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.code}
                className="etf-row"
                onClick={() => onOpen(row.code)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(row.code);
                  }
                }}
              >
                <td className="mono">{row.code}</td>
                <td>{row.name}</td>
                <td className="num">
                  {row.status === 'ready' && row.latestValue !== undefined
                    ? formatYiShares(row.latestValue)
                    : <span className="muted">{statusGlyph(row.status)}</span>}
                </td>
                <td className="num">
                  <ChangeCell cp={row.daily} status={row.status} />
                </td>
                <td className="num">
                  <ChangeCell cp={row.weekly} status={row.status} />
                </td>
                <td className="num">
                  <ChangeCell cp={row.monthly} status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function changePct(row: EnrichedRow, kind: ChangeKind): number | undefined {
  const cp = kind === 'daily' ? row.daily : kind === 'weekly' ? row.weekly : row.monthly;
  if (!cp) return undefined;
  // Skip null pct (first entry of the change series has no prior anchor).
  return typeof cp.pct === 'number' ? cp.pct : undefined;
}

function SortableTh({
  label,
  isActive,
  sortDir,
  onClick,
}: {
  label: string;
  isActive: boolean;
  sortDir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className={`sortable${isActive ? ' active' : ''}`}
      onClick={onClick}
      aria-sort={isActive ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      {isActive ? <span className="sort-arrow">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
    </th>
  );
}

function ChangeCell({ cp, status }: { cp?: ChangePoint; status: EnrichedRow['status'] }) {
  if (status === 'loading') return <span className="muted">…</span>;
  if (status === 'error') return <span className="muted error">错误</span>;
  if (status === 'empty' || !cp || cp.value === null || cp.pct === null) {
    return <span className="muted">-</span>;
  }
  const cls = cp.value > 0 ? 'pos' : cp.value < 0 ? 'neg' : 'flat';
  return (
    <span className={`change-cell ${cls}`} title={`${formatChangeShares(cp.value)} (${formatPct(cp.pct)})`}>
      <span className="change-pct">{formatPct(cp.pct)}</span>
      <span className="change-val">{formatChangeShares(cp.value)}</span>
    </span>
  );
}

function statusGlyph(status: EnrichedRow['status']): string {
  if (status === 'loading') return '…';
  if (status === 'error') return '错误';
  if (status === 'empty') return '-';
  return '-';
}

/**
 * Renders nothing visible — its job is to fetch the share data for one ETF
 * and lift the resulting `EnrichedRow` to the parent via `onLoaded`. This is
 * the standard rules-of-hooks-safe pattern for "N parallel data hooks".
 */
function RowLifter({
  code,
  name,
  onLoaded,
}: {
  code: string;
  name: string;
  onLoaded: (row: EnrichedRow) => void;
}) {
  const state = useEtfShares(code);
  useEffect(() => {
    if (state.status === 'loading') {
      onLoaded({ code, name, status: 'loading' });
      return;
    }
    if (state.status === 'error') {
      onLoaded({ code, name, status: 'error' });
      return;
    }
    if (state.status === 'empty') {
      onLoaded({ code, name, status: 'empty' });
      return;
    }
    if (state.status === 'ready' && state.data) {
      const latest = latestShare(state.data.shares);
      onLoaded({
        code,
        name,
        status: 'ready',
        latestValue: latest?.value,
        daily: latestChange(state.data, 'daily'),
        weekly: latestChange(state.data, 'weekly'),
        monthly: latestChange(state.data, 'monthly'),
      });
    }
  }, [state, code, name, onLoaded]);
  return null;
}