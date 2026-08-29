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
const PROTOTYPE_PATH = '/vendors/prototype-punchout';

function isPublicPath(pathname: string): boolean {
  return (
    (process.env.NODE_ENV !== 'production' && pathname === PROTOTYPE_PATH) ||
    PUBLIC_PATH_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

interface AccessContextValue {
  access: EffectiveAccessDocument | null;
  error: unknown | null;
  loading: boolean;
  resolved: boolean;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname);
  const [access, setAccess] = useState<EffectiveAccessDocument | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvedPath, setResolvedPath] = useState<string | null>(() =>
    publicPath ? pathname : null,
  );
  const requestId = useRef(0);
  const resolved = publicPath || resolvedPath === pathname;

  const refresh = useCallback(async () => {
    if (publicPath) {
      setAccess(null);
      setError(null);
      setLoading(false);
      setResolvedPath(pathname);
      return;
    }

    const currentRequestId = ++requestId.current;
    const requestPath = pathname;
    setLoading(true);
    setError(null);
    try {
      const nextAccess = await api.me.access();
      if (currentRequestId === requestId.current) {
        setAccess(nextAccess);
        setResolvedPath(requestPath);
      }
    } catch (nextError) {
      if (currentRequestId === requestId.current) {
        setAccess(null);
        setError(nextError);
        setResolvedPath(requestPath);
      }
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [pathname, publicPath]);

  useEffect(() => {
    // Invalidate a request from the previous route before clearing or refetching state.
    requestId.current += 1;
    if (publicPath) {
      setAccess(null);
      setError(null);
      setLoading(false);
      setResolvedPath(pathname);
      return;
    }
    setError(null);
    setResolvedPath(null);
    void refresh();
  }, [pathname, publicPath, refresh]);

  const value = useMemo(
    () => ({ access, error, loading, resolved, refresh }),
    [access, error, loading, resolved, refresh],
  );
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error('useAccess must be used inside AccessProvider');
  return value;
}
