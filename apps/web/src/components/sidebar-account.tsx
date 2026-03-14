'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronUp, LogOut, Settings, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

type AccountState = {
  name: string;
  email: string;
  avatarUrl: string;
};

const INITIAL_ACCOUNT: AccountState = {
  name: 'Account',
  email: '',
  avatarUrl: '',
};

export function SidebarAccount({
  collapsed,
  onSignOut,
}: {
  collapsed?: boolean;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<AccountState>(INITIAL_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.account
      .me()
      .then((data) => setAccount(data))
      .catch(() => setAccount(INITIAL_ACCOUNT))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleShortcutEscape() {
      setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('betterspend:escape', handleShortcutEscape as EventListener);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('betterspend:escape', handleShortcutEscape as EventListener);
    };
  }, []);

  const initial = account.name.trim().charAt(0).toUpperCase() || 'A';

  return (
    <div ref={dropdownRef} className="relative border-t border-sidebar-border px-3 py-3">
      <button
        type="button"
        title={collapsed ? account.name : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.06]',
          collapsed && 'justify-center px-2',
        )}
      >
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] text-sidebar-foreground">
          {account.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.avatarUrl} alt={account.name} className="size-full object-cover" />
          ) : (
            <span className="text-sm font-semibold">{initial}</span>
          )}
        </div>
        {!collapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-sidebar-foreground">
                {loading ? 'Loading account...' : account.name}
              </div>
              <div className="truncate text-xs text-sidebar-muted">
                {account.email || 'Signed in'}
              </div>
            </div>
            <ChevronUp className={cn('size-4 text-sidebar-muted transition-transform', open && 'rotate-180')} />
          </>
        ) : null}
      </button>

      {open ? (
        <Card
          className={cn(
            'absolute z-50 w-[16rem] overflow-hidden border border-border/70 bg-card shadow-2xl',
            collapsed ? 'bottom-0 left-[calc(100%+0.75rem)]' : 'bottom-[calc(100%+0.75rem)] left-0',
          )}
        >
          <CardHeader className="border-b border-border/70 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-muted text-foreground">
                {account.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.avatarUrl} alt={account.name} className="size-full object-cover" />
                ) : (
                  <span className="text-lg font-semibold">{initial}</span>
                )}
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{loading ? 'Loading account...' : account.name}</CardTitle>
                <CardDescription className="truncate">{account.email}</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-1 pt-4">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <UserRound className="size-4 text-muted-foreground" />
              <span>Profile</span>
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <Settings className="size-4 text-muted-foreground" />
              <span>Settings</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void onSignOut();
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <LogOut className="size-4 text-muted-foreground" />
              <span>Sign out</span>
            </button>
          </CardContent>
        </Card>
      ) : null}

      {!open ? (
        <button
          type="button"
          title={collapsed ? 'Sign out' : undefined}
          onClick={() => void onSignOut()}
          className={cn(
            'mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/[0.05] hover:text-sidebar-foreground',
            collapsed && 'justify-center px-2',
          )}
        >
          <LogOut className="size-4" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      ) : null}
    </div>
  );
}
