'use client';

import { useEffect, useState } from 'react';
import { CalendarRange, Plus, Undo2, UserCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function DelegationStatusBadge({
  active,
  startDate,
  endDate,
}: {
  active: boolean;
  startDate: string;
  endDate: string;
}) {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  let label = 'Inactive';
  let variant: 'warning' | 'success' | 'destructive' = 'warning';

  if (active) {
    if (now >= start && now <= end) {
      label = 'Active';
      variant = 'success';
    } else if (now < start) {
      label = 'Upcoming';
      variant = 'warning';
    } else {
      label = 'Expired';
      variant = 'destructive';
    }
  }

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        variant === 'success'
          ? 'bg-emerald-100 text-emerald-800'
          : variant === 'warning'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-rose-100 text-rose-800'
      }`}
    >
      {label}
    </span>
  );
}

export default function ApprovalDelegationsPage() {
  const [myDelegations, setMyDelegations] = useState<any[]>([]);
  const [delegateForMe, setDelegateForMe] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    delegateeId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [myData, forMeData, usersData] = await Promise.all([
        api.approvalDelegations.my(),
        api.approvalDelegations.delegateForMe(),
        api.users.list(),
      ]);
      setMyDelegations(myData);
      setDelegateForMe(forMeData);
      setUsers(usersData);
    } catch {
      // keep empty state
    } finally {
      setLoading(false);
    }
  }

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCreate() {
    if (!form.delegateeId || !form.startDate || !form.endDate) {
      setError('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.approvalDelegations.create({
        delegateeId: form.delegateeId,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || undefined,
      });
      setShowForm(false);
      setForm({ delegateeId: '', startDate: '', endDate: '', reason: '' });
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create delegation');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this delegation?')) return;
    try {
      await api.approvalDelegations.cancel(id);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to cancel delegation');
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Approval Delegations"
        description="Temporarily reroute approval responsibility during leave, travel, or coverage windows without changing core role assignments."
        actions={
          <Button type="button" onClick={() => setShowForm((current) => !current)}>
            <Plus className="h-4 w-4" />
            {showForm ? 'Hide Form' : 'New Delegation'}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Delegation Setup</CardTitle>
            <CardDescription>Choose a delegate, define the coverage window, and optionally record a reason for audit context.</CardDescription>
          </CardHeader>
          <CardContent>
            {showForm ? (
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Delegate To</label>
                  <Select
                    value={form.delegateeId}
                    onChange={(event) => setField('delegateeId', event.target.value)}
                    className="w-full"
                  >
                    <option value="">Select a user...</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Start Date</label>
                    <Input
                      type="date"
                      value={form.startDate}
                      onChange={(event) => setField('startDate', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">End Date</label>
                    <Input
                      type="date"
                      value={form.endDate}
                      onChange={(event) => setField('endDate', event.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Reason</label>
                  <Input
                    value={form.reason}
                    onChange={(event) => setField('reason', event.target.value)}
                    placeholder="Out of office, leave coverage, etc."
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button type="button" onClick={handleCreate} disabled={saving}>
                    <Plus className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Create Delegation'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                <CalendarRange className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">Delegation controls are ready</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open the form to schedule temporary approval coverage without changing permanent org structure.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Delegated By Me</CardTitle>
              <CardDescription>Coverage windows where another user is acting on your behalf.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                  Loading delegations...
                </div>
              ) : myDelegations.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                  No active or historical delegations yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delegatee</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myDelegations.map((delegation) => (
                      <TableRow key={delegation.id}>
                        <TableCell className="font-medium text-foreground">
                          {delegation.delegatee?.name || delegation.delegateeId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(delegation.startDate)} - {formatDate(delegation.endDate)}
                        </TableCell>
                        <TableCell>
                          <DelegationStatusBadge
                            active={delegation.isActive}
                            startDate={delegation.startDate}
                            endDate={delegation.endDate}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {delegation.reason || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {delegation.isActive ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancel(delegation.id)}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              Cancel
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Delegated To Me</CardTitle>
              <CardDescription>Approvals you are currently covering for other teammates.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                  Loading inbound delegations...
                </div>
              ) : delegateForMe.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                  <UserCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">No delegations assigned to you</div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    When a teammate delegates approvals to you, they will appear here automatically.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delegator</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {delegateForMe.map((delegation) => (
                      <TableRow key={delegation.id}>
                        <TableCell className="font-medium text-foreground">
                          {delegation.delegator?.name || delegation.delegatorId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(delegation.startDate)} - {formatDate(delegation.endDate)}
                        </TableCell>
                        <TableCell>
                          <DelegationStatusBadge
                            active={delegation.isActive}
                            startDate={delegation.startDate}
                            endDate={delegation.endDate}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {delegation.reason || '—'}
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
    </div>
  );
}
