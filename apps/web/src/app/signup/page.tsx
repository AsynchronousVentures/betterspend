'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, KeyRound, Mail, UserRound } from 'lucide-react';
import { signUp } from '../../lib/auth-client';
import { AuthShell } from '../../components/auth-shell';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

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
      const result = await signUp(email, password, name);
      if (result.error || result.message?.toLowerCase().includes('already')) {
        setError(result.message || result.error || 'Sign-up failed');
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create account"
      description="Set up your BetterSpend workspace access with the new token-driven UI foundation."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary transition-colors hover:text-primary/80">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Full name</label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jane Smith" className="h-11 pl-10" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" className="h-11 pl-10" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Password</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="••••••••" className="h-11 pl-10" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Confirm password</label>
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
          {loading ? 'Creating account...' : 'Create account'}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </Button>
      </form>
    </AuthShell>
  );
}
