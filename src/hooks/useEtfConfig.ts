import { useEffect, useState } from 'react';
import YAML from 'yaml';
import type { EtfConfig } from '../types/config';

export type ConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: EtfConfig }
  | { status: 'error'; error: string };

/**
 * Loads the dashboard config. Tries JSON first (fast), then YAML (fallback).
 * Resolves all asset paths through `import.meta.env.BASE_URL` so the same
 * build works for the dev server, root-hosted static deploys, and
 * GitHub-Pages-style subpath deploys.
 */
export function useEtfConfig(): ConfigState {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.BASE_URL || '/';

    async function tryLoad(path: string, parser: 'json' | 'yaml'): Promise<EtfConfig> {
      const url = `${base.replace(/\/$/, '')}/${path}`.replace(/\/+/g, '/');
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      // Guard against SPA fallback: if the body looks like HTML it's the
      // index.html, not our config.
      const trimmed = text.trimStart();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
        throw new Error(`Expected config but got HTML at ${url}`);
      }
      const parsed = parser === 'json' ? JSON.parse(text) : YAML.parse(text);
      return parsed as EtfConfig;
    }

    (async () => {
      try {
        const config = await tryLoad('config/etfs.json', 'json');
        if (!cancelled) setState({ status: 'ready', config });
      } catch (jsonErr) {
        try {
          const config = await tryLoad('config/etfs.yaml', 'yaml');
          if (!cancelled) setState({ status: 'ready', config });
        } catch (yamlErr) {
          const msg = yamlErr instanceof Error ? yamlErr.message : String(yamlErr);
          if (!cancelled) setState({ status: 'error', error: msg });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}