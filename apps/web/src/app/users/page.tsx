'use client';

import { useEffect, useState } from 'react';
import { ShieldPlus, UserCog, UserPlus, UserX } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const ROLES = ['admin', 'approver', 'requester', 'receiver', 'finance'];
const EMPTY_FORM = { name: '', email: '', password: '', role: 'requester' };

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addRoleUserId, setAddRoleUserId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState('requester');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setUsers(await api.users.list());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setFormError('Name, email, and password are required.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await api.users.create({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role || undefined,
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: any) {
    try {
      if (user.isActive) {
        await api.users.deactivate(user.id);
      } else {
        await api.users.activate(user.id);
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAddRole(userId: string) {
    try {
      await api.users.addRole(userId, { role: newRole, scopeType: 'global' });
      setAddRoleUserId(null);
      setNewRole('requester');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRemoveRole(userId: string, roleId: string) {
    if (!confirm('Remove this role?')) return;
    try {
      await api.users.removeRole(userId, roleId);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Users"
        description="Manage user access, global roles, and activation status across the procurement workspace."
        actions={
          <Button
            type="button"
            onClick={() => {
              setShowForm((current) => !current);
              setFormError('');
              setForm(EMPTY_FORM);
            }}
          >
            <UserPlus className="h-4 w-4" />
            {showForm ? 'Hide Invite Form' : 'Invite User'}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">User invitation</CardTitle>
            <CardDescription>Create new accounts with a temporary password and an initial global role.</CardDescription>
          </CardHeader>
          <CardContent>
            {showForm ? (
              <form onSubmit={handleCreate} className="space-y-5">
                <div className="grid gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Full name</label>
                    <Input value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Email</label>
                    <Input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} placeholder="jane@company.com" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Temporary password</label>
                    <Input type="password" value={form.password} onChange={(event) => setField('password', event.target.value)} placeholder="Temporary password" autoComplete="new-password" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Initial role</label>
                    <Select value={form.role} onChange={(event) => setField('role', event.target.value)} className="w-full">
                      <option value="">No role</option>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                {formError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={saving}>
                    <UserPlus className="h-4 w-4" />
                    {saving ? 'Creating...' : 'Create User'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                <UserCog className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">Ready to onboard another teammate</div>
                <p className="mt-2 text-sm text-muted-foreground">Open the invite form to issue a new account, then manage roles from the directory.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">User directory</CardTitle>
            <CardDescription>See current access levels, activate or deactivate accounts, and assign roles without leaving the list.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No users found.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{user.name}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <StatusBadge value={user.isActive ? 'active' : 'inactive'} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {(user.userRoles || []).map((role: any) => (
                            <Badge key={role.id} variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-sky-700">
                              {role.role}
                              <button
                                type="button"
                                onClick={() => handleRemoveRole(user.id, role.id)}
                                className="rounded-full text-sky-500 transition-colors hover:text-sky-800"
                              >
                                ×
                              </button>
                            </Badge>
                          ))}
                          {addRoleUserId === user.id ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2 py-1">
                              <Select value={newRole} onChange={(event) => setNewRole(event.target.value)} className="h-8 min-w-[8rem] border-0 bg-transparent py-0 pr-8 shadow-none">
                                {ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </Select>
                              <Button type="button" size="sm" onClick={() => handleAddRole(user.id)}>
                                Add
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => setAddRoleUserId(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button type="button" variant="outline" size="sm" onClick={() => setAddRoleUserId(user.id)}>
                              <ShieldPlus className="h-3.5 w-3.5" />
                              Role
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => toggleActive(user)}>
                          <UserX className="h-3.5 w-3.5" />
                          {user.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
