'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, type VendorPortalUser } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

function formatLastLogin(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

/** Admin-side management of the email/password logins a vendor can use on the portal. */
export function VendorPortalLogins({ vendorId }: { vendorId: string }) {
  const [logins, setLogins] = useState<VendorPortalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '' });

  const load = useCallback(
    () =>
      api.vendorPortal
        .listUsers(vendorId)
        .then(setLogins)
        .catch((err: any) => {
          setMessage(`Error: ${err.message || 'Failed to load portal logins'}`);
        })
        .finally(() => setLoading(false)),
    [vendorId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Request failed'}`);
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api.vendorPortal.createUser({
        vendorId,
        email: form.email,
        password: form.password,
        name: form.name || undefined,
      });
      setForm({ email: '', name: '', password: '' });
    }, `Login created for ${form.email.trim().toLowerCase()}.`);
  }

  function handleReset(login: VendorPortalUser) {
    const password = window.prompt(`New password for ${login.email} (at least 8 characters):`);
    if (!password) return;
    void run(
      () => api.vendorPortal.resetUserPassword(login.id, password),
      `Password reset for ${login.email}. Existing portal sessions were signed out.`,
    );
  }

  function handleToggle(login: VendorPortalUser) {
    const status = login.status === 'active' ? 'disabled' : 'active';
    void run(
      () => api.vendorPortal.updateUser(login.id, { status }),
      `${login.email} is now ${status}.`,
    );
  }

  function handleRemove(login: VendorPortalUser) {
    if (!window.confirm(`Delete the portal login for ${login.email}?`)) return;
    void run(() => api.vendorPortal.removeUser(login.id), `Deleted ${login.email}.`);
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading portal logins...</p>
      ) : logins.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No portal logins yet. Create one below so this supplier can sign in with an email and
          password instead of waiting for an access link.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logins.map((login) => (
              <TableRow key={login.id}>
                <TableCell className="font-medium">{login.email}</TableCell>
                <TableCell>{login.name || '—'}</TableCell>
                <TableCell className="capitalize">{login.status}</TableCell>
                <TableCell>{formatLastLogin(login.lastLoginAt)}</TableCell>
                <TableCell className="space-x-2 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleReset(login)}
                  >
                    Reset password
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleToggle(login)}
                  >
                    {login.status === 'active' ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => handleRemove(login)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
        <Input
          type="email"
          required
          placeholder="contact@supplier.com"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        <Input
          placeholder="Contact name (optional)"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <Input
          type="password"
          required
          minLength={8}
          placeholder="Temporary password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        <Button type="submit" disabled={busy}>
          Add login
        </Button>
      </form>

      {message ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${message.startsWith('Error') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
