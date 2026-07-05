import { useEffect, useState } from 'react';
import { useEtfConfig } from '../hooks/useEtfConfig';
import type { SharePoint } from '../types/config';
import { ShareChart } from '../components/ShareChart';
import { ChartGroup } from '../components/ChartGroup';
import { EtfSharesState, useEtfShares } from '../hooks/useEtfShares';
import { expandEntryCode } from '../utils/series';

/**
 * The dashboard's "main chart" is structurally the same as a sub-chart group
 * — it just has the full-width treatment. To stay DRY we still hand-roll the
 * multi-code fetch via Aggregator (the same component ChartGroup uses).
 */
export function Dashboard() {
  const configState = useEtfConfig();

  if (configState.status === 'loading') {
    return <CenterNotice>正在加载配置…</CenterNotice>;
  }
  if (configState.status === 'error') {
    return (
      <CenterNotice tone="error">
        配置加载失败：{configState.error}
        <br />
        请确认 <code>public/config/etfs.json</code> 或 <code>etfs.yaml</code> 存在。
      </CenterNotice>
    );
  }

  const config = configState.config;
  // An entry's `code` may be a single string or an array of strings (the
  // latter means "aggregate these ETFs' daily sums"). Flatten to the unique
  // list of underlying codes so we only fetch each ETF once.
  const mainCodes = uniqueOrdered(
    config.mainChart.etfs.flatMap((e) => expandEntryCode(e.code)),
  );

  return (
    <div className="dashboard">
      <section className="main-chart-section">
        <h2 className="section-title">{config.mainChart.title}</h2>
        <Aggregator codes={mainCodes}>
          {(states) => {
            const data: Record<string, SharePoint[]> = {};
            let loading = false;
            for (const [code, state] of Object.entries(states)) {
              if (state.status === 'loading') loading = true;
              if (state.status === 'ready' && state.data) {
                data[code] = state.data.shares;
              }
            }
            return (
              <ShareChart
                title={config.mainChart.title}
                refs={config.mainChart.etfs}
                data={data}
                loading={loading}
              />
            );
          }}
        </Aggregator>
      </section>

      {config.subCharts.length === 0 ? (
        <CenterNotice>暂无副图分组。请在 etfs.yaml 中添加 subCharts 条目。</CenterNotice>
      ) : (
        config.subCharts.map((group) => <ChartGroup key={group.id} group={group} />)
      )}
    </div>
  );
}

interface AggregatorProps {
  codes: string[];
  children: (states: Record<string, EtfSharesState>) => React.ReactNode;
}

/**
 * Duplicated from ChartGroup for the main chart because we want it to span
 * full width and not be wrapped in the sub-chart-group styling. Kept here
 * intentionally rather than extracting — total surface area is small.
 */
function Aggregator({ codes, children }: AggregatorProps) {
  const key = codes.join('|');
  const [states, setStates] = useState<Record<string, EtfSharesState>>(() =>
    Object.fromEntries(codes.map((c) => [c, { status: 'loading' as const }])),
  );

  useEffect(() => {
    setStates(
      Object.fromEntries(codes.map((c) => [c, { status: 'loading' as const }])),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {codes.map((code) => (
        <StateLifter
          key={code}
          code={code}
          onState={(s) => {
            setStates((prev) => {
              const cur = prev[code];
              if (
                cur &&
                cur.status === s.status &&
                cur.data === s.data &&
                cur.error === s.error
              ) {
                return prev;
              }
              return { ...prev, [code]: s };
            });
          }}
        />
      ))}
      {children(states)}
    </>
  );
}

function StateLifter({
  code,
  onState,
}: {
  code: string;
  onState: (s: EtfSharesState) => void;
}) {
  const state = useEtfShares(code);
  // Lift on every state transition.
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function CenterNotice({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'error';
}) {
  return (
    <div
      style={{
        padding: '2rem 1rem',
        textAlign: 'center',
        color: tone === 'error' ? '#dc2626' : '#475569',
        background: '#fff',
        border: '1px dashed #cbd5e1',
        borderRadius: 8,
        margin: '1rem 0',
      }}
    >
      {children}
    </div>
  );
}

/** De-duplicate while preserving first-seen order. */
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