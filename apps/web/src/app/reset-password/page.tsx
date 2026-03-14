'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, KeyRound } from 'lucide-react';
import { api } from '../../lib/api';
import { AuthShell } from '../../components/auth-shell';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Missing reset token. Please use the link from your email.');
      return;
    }

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await api.passwordReset.reset(token, password);
      router.push('/login?reset=1');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please request a new reset link.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Set new password"
      description="Create a fresh password and return to the BetterSpend workspace."
      footer={
        <Link href="/login" className="font-medium text-primary transition-colors hover:text-primary/80">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <Alert variant="destructive">
          <AlertDescription>
            Invalid reset link. Please request a new one from the forgot password screen.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">New password</label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="••••••••" className="h-11 pl-10" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Confirm new password</label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="••••••••" className="h-11 pl-10" />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={loading} className="h-11 w-full rounded-lg">
            {loading ? 'Resetting...' : 'Reset password'}
            {!loading ? <ArrowRight className="size-4" /> : null}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
