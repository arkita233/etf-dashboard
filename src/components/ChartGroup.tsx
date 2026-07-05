import { useEffect, useState } from 'react';
import type { ChartGroup as ChartGroupConfig, SharePoint } from '../types/config';
import type { EtfSharesState } from '../hooks/useEtfShares';
import { useEtfShares } from '../hooks/useEtfShares';
import { expandEntryCode } from '../utils/series';
import { ShareChart } from './ShareChart';

/**
 * A sub-chart group: title + one ShareChart that overlays all the group's
 * ETFs on the same date axis (good for relative comparison).
 *
 * Each entry's `code` may be a single 6-digit string or an array of strings
 * (the latter means "sum the listed ETFs' daily shares into one line").
 * Underlying codes are fetched individually, deduplicated, and the chart's
 * legend/tooltip shows each entry's `name` verbatim.
 *
 * Internally triggers one fetch per underlying ETF code via useEtfShares;
 * results are cached by the hook so re-renders don't refetch.
 */
export function ChartGroup({ group }: { group: ChartGroupConfig }) {
  const codes = uniqueOrdered(
    group.etfs.flatMap((e) => expandEntryCode(e.code)),
  );
  return (
    <section className="chart-group">
      <h2 className="chart-group-title">{group.title}</h2>
      <Aggregator codes={codes}>
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
              title={group.title}
              refs={group.etfs}
              data={data}
              loading={loading}
              compact
            />
          );
        }}
      </Aggregator>
      <p className="chart-group-meta">
        包含 {group.etfs.length} 项配置（合 {codes.length} 只底层 ETF）：
        {group.etfs
          .map((e) => {
            const c = Array.isArray(e.code) ? e.code.join('+') : e.code;
            return `${c} ${e.name}`;
          })
          .join(' / ')}
      </p>
    </section>
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

interface AggregatorProps {
  codes: string[];
  children: (states: Record<string, EtfSharesState>) => React.ReactNode;
}

/**
 * Helper that calls useEtfShares once per code (via a child component per
 * code) and lifts each child's state into a single record the parent can
 * consume. This is the standard "rules-of-hooks safe N-hook" pattern.
 */
function Aggregator({ codes, children }: AggregatorProps) {
  const key = codes.join('|');
  const [states, setStates] = useState<Record<string, EtfSharesState>>(() =>
    Object.fromEntries(codes.map((c) => [c, { status: 'loading' as const }])),
  );

  useEffect(() => {
    // Reset when the codes list changes.
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
  useEffect(() => {
    onState(state);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}