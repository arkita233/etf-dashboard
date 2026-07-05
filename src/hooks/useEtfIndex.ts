import { useEffect, useState } from 'react';
import type { EtfIndex, EtfIndexDoc, EtfIndexEntry } from '../types/config';

export type EtfIndexState =
  | { status: 'loading' }
  | { status: 'ready'; index: EtfIndex }
  | { status: 'error'; error: string };

/**
 * Loads the list of all ETFs available under public/data/etfs/.
 *
 * The data-layer team has produced two shapes over time:
 *   - v1 (legacy): `[{ code, name }]`
 *   - v2 (current): `{ generatedAt, source, etfs: [...] }` where each entry
 *     may also carry precomputed `latestShares`, `latestDailyChange`, etc.
 *
 * Both shapes are accepted; the hook normalizes to a flat `EtfIndex` array.
 * `EtfIndexEntry` already carries the optional v2 fields, so consumers can
 * use them when present and fall back to fetching per-ETF JSON otherwise.
 *
 * Uses import.meta.env.BASE_URL so the same build works for the dev server,
 * root-hosted static deploys, and GitHub-Pages-style subpath deploys.
 */
export function useEtfIndex(): EtfIndexState {
  const [state, setState] = useState<EtfIndexState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.BASE_URL || '/';
    const url = `${base.replace(/\/$/, '')}/data/etfs/index.json`.replace(/\/+/g, '/');

    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.status === 404) {
          if (!cancelled) setState({ status: 'error', error: '未找到 ETF 清单文件 (index.json)' });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = (await res.json()) as EtfIndexDoc;
        const index = normalize(doc);
        if (!cancelled) setState({ status: 'ready', index });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setState({ status: 'error', error: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function normalize(doc: EtfIndexDoc): EtfIndex {
  if (Array.isArray(doc)) return doc as EtfIndexEntry[];
  if (doc && Array.isArray((doc as { etfs?: unknown }).etfs)) {
    return (doc as { etfs: EtfIndexEntry[] }).etfs;
  }
  return [];
}