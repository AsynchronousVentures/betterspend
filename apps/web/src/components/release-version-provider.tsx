'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { appReleaseVersion, parseRuntimeReleaseVersion } from '../lib/release';

interface ReleaseVersionState {
  version: string;
  isLoading: boolean;
}

const initialReleaseVersionState: ReleaseVersionState = {
  version: appReleaseVersion,
  isLoading: true,
};

const ReleaseVersionContext = createContext(initialReleaseVersionState);

export function ReleaseVersionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialReleaseVersionState);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let version = appReleaseVersion;
      try {
        const response = await fetch('/runtime-version', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const payload: unknown = await response.json();
          version = parseRuntimeReleaseVersion(payload) ?? appReleaseVersion;
        }
      } catch {
        // Keep the package fallback when the runtime route is unavailable.
      }

      if (!cancelled) setState({ version, isLoading: false });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <ReleaseVersionContext.Provider value={state}>{children}</ReleaseVersionContext.Provider>;
}

export function useReleaseVersion(): ReleaseVersionState {
  return useContext(ReleaseVersionContext);
}
