'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import type { EffectiveAccessDocument } from '@betterspend/shared';
import { api } from '../lib/api';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/punchout',
  '/forgot-password',
  '/reset-password',
  '/vendor-portal',
  '/account/verify-email',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

interface AccessContextValue {
  access: EffectiveAccessDocument | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname);
  const [access, setAccess] = useState<EffectiveAccessDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (publicPath) {
      setAccess(null);
      setLoading(false);
      return;
    }

    const currentRequestId = ++requestId.current;
    setLoading(true);
    try {
      const nextAccess = await api.me.access();
      if (currentRequestId === requestId.current) setAccess(nextAccess);
    } catch {
      if (currentRequestId === requestId.current) setAccess(null);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [publicPath]);

  useEffect(() => {
    // Invalidate a request from the previous route before clearing or refetching state.
    requestId.current += 1;
    if (publicPath) {
      setAccess(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [publicPath, refresh]);

  const value = useMemo(() => ({ access, loading, refresh }), [access, loading, refresh]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error('useAccess must be used inside AccessProvider');
  return value;
}
