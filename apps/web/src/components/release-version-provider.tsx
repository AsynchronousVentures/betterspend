'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { appReleaseVersion, parseRuntimeReleaseVersion } from '../lib/release';

const ReleaseVersionContext = createContext(appReleaseVersion);

export function ReleaseVersionProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(appReleaseVersion);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/runtime-version', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;

        const payload: unknown = await response.json();
        const runtimeVersion = parseRuntimeReleaseVersion(payload);
        if (!cancelled && runtimeVersion) setVersion(runtimeVersion);
      } catch {
        // Keep the package fallback when the runtime route is unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ReleaseVersionContext.Provider value={version}>{children}</ReleaseVersionContext.Provider>
  );
}

export function useReleaseVersion(): string {
  return useContext(ReleaseVersionContext);
}
