import { useEffect, useState } from 'react';
import type { EtfShareData } from '../types/config';

export interface EtfSharesState {
  status: 'loading' | 'ready' | 'error' | 'empty';
  data?: EtfShareData;
  error?: string;
}

/**
 * Loads share data for a single ETF code.
 *
 * Caches results by code within the same session so multiple components that
 * reference the same ETF share one network round-trip.
 */
const cache = new Map<string, EtfShareData>();

export function useEtfShares(code: string): EtfSharesState {
  const [state, setState] = useState<EtfSharesState>(() => {
    const cached = cache.get(code);
    return cached
      ? { status: 'ready', data: cached }
      : { status: 'loading' };
  });

  useEffect(() => {
    if (!code) {
      setState({ status: 'empty' });
      return;
    }
    if (cache.has(code)) {
      setState({ status: 'ready', data: cache.get(code) });
      return;
    }
    let cancelled = false;
    const base = import.meta.env.BASE_URL || '/';
    const url = `${base.replace(/\/$/, '')}/data/etfs/${encodeURIComponent(code)}.json`.replace(/\/+/g, '/');

    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.status === 404) {
          if (!cancelled) setState({ status: 'empty' });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Guard against SPA fallback (vite preview serves index.html for unknown
        // paths with a 200 status). If the body isn't JSON, treat as empty.
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          if (!cancelled) setState({ status: 'empty' });
          return;
        }
        const data = (await res.json()) as EtfShareData;
        if (!cancelled) {
          cache.set(code, data);
          setState({ status: 'ready', data });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setState({ status: 'error', error: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  return state;
}