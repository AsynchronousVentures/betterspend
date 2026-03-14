'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Mail, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

type AccountState = {
  name: string;
  email: string;
  avatarUrl: string;
  hasCustomImage: boolean;
  pendingEmail: string | null;
  pendingEmailExpiresAt: string | null;
};

const INITIAL_ACCOUNT: AccountState = {
  name: 'Account',
  email: '',
  avatarUrl: '',
  hasCustomImage: false,
  pendingEmail: null,
  pendingEmailExpiresAt: null,
};

export function AccountProfileForm() {
  const [account, setAccount] = useState<AccountState>(INITIAL_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [name, setName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadAccount() {
    try {
      const data = await api.account.me();
      setAccount(data);
      setName(data.name);
      setNewEmail(data.pendingEmail ?? '');
    } catch (err: any) {
      setError(err.message ?? 'Failed to load account');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  function resetNotice() {
    setMessage('');
    setError('');
  }

  async function handleSaveName() {
    resetNotice();
    if (!name.trim()) {
      setError('Display name is required');
      return;
    }
    setSavingName(true);
    try {
      const data = await api.account.update({ name: name.trim() });
      setAccount(data);
      setMessage('Display name updated.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function handleRequestEmailChange() {
    resetNotice();
    if (!newEmail.trim()) {
      setError('Email is required');
      return;
    }
    setSavingEmail(true);
    try {
      const result = await api.account.requestEmailChange(newEmail.trim());
      setAccount((current) => ({
        ...current,
        pendingEmail: result.pendingEmail,
        pendingEmailExpiresAt: result.pendingEmailExpiresAt,
      }));
      setMessage(`Verification sent to ${result.pendingEmail}.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleChangePassword() {
    resetNotice();
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (passwords.newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSavingPassword(true);
    try {
      await api.account.changePassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('Password changed successfully.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleAvatarUpload(file: File) {
    resetNotice();
    setSavingAvatar(true);
    try {
      const data = await api.account.uploadAvatar(file);
      setAccount(data);
      setMessage('Profile photo updated.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveAvatar() {
    resetNotice();
    setSavingAvatar(true);
    try {
      await api.account.removeAvatar();
      await loadAccount();
      setMessage('Custom photo removed. Gravatar will be used instead.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingAvatar(false);
    }
  }

  const initial = account.name.trim().charAt(0).toUpperCase() || 'A';

  return (
    <Card className="max-w-2xl rounded-lg">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex items-center gap-4">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-muted text-foreground">
            {account.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.avatarUrl} alt={account.name} className="size-full object-cover" />
            ) : (
              <span className="text-lg font-semibold">{initial}</span>
            )}
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-xl">{loading ? 'Loading account...' : account.name}</CardTitle>
            <CardDescription className="truncate">{account.email}</CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleAvatarUpload(file);
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={savingAvatar}>
            {savingAvatar ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Camera className="mr-2 size-4" />}
            {account.hasCustomImage ? 'Replace photo' : 'Upload photo'}
          </Button>
          {account.hasCustomImage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void handleRemoveAvatar()} disabled={savingAvatar}>
              <Trash2 className="mr-2 size-4" />
              Use Gravatar
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {account.pendingEmail ? (
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription>
              Verification pending for {account.pendingEmail}
              {account.pendingEmailExpiresAt ? ` until ${new Date(account.pendingEmailExpiresAt).toLocaleString()}` : ''}.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Display Name</div>
          <div className="flex gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your display name" />
            <Button type="button" size="sm" onClick={() => void handleSaveName()} disabled={savingName}>
              {savingName ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Email</div>
          <div className="text-sm text-muted-foreground">Current: {account.email}</div>
          <div className="flex gap-2">
            <Input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="New email address" />
            <Button type="button" size="sm" onClick={() => void handleRequestEmailChange()} disabled={savingEmail}>
              {savingEmail ? 'Sending...' : 'Verify'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Password</div>
          <Input
            type="password"
            value={passwords.currentPassword}
            onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))}
            placeholder="Current password"
            autoComplete="current-password"
          />
          <Input
            type="password"
            value={passwords.newPassword}
            onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))}
            placeholder="New password"
            autoComplete="new-password"
          />
          <Input
            type="password"
            value={passwords.confirmPassword}
            onChange={(event) => setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))}
            placeholder="Confirm new password"
            autoComplete="new-password"
          />
          <Button type="button" size="sm" onClick={() => void handleChangePassword()} disabled={savingPassword}>
            {savingPassword ? 'Updating...' : 'Update password'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
