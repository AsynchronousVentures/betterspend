'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { Mail, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { AuthShell } from '../../components/auth-shell';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.passwordReset.request(email);
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset password"
      description="Send a secure reset link to your inbox so you can get back into BetterSpend."
      footer={
        <Link href="/login" className="font-medium text-primary transition-colors hover:text-primary/80">
          Back to sign in
        </Link>
      }
    >
      {submitted ? (
        <Alert variant="success">
          <AlertDescription>
            If an account exists for <strong>{email}</strong>, a password reset link has been sent. Please check your inbox.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm leading-6 text-muted-foreground">
            Enter your email address and we’ll send a reset link. If the account exists, the message is on its way.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="h-11 pl-10"
                />
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" disabled={loading} className="h-11 w-full rounded-lg">
              {loading ? 'Sending...' : 'Send reset link'}
              {!loading ? <Send className="size-4" /> : null}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
