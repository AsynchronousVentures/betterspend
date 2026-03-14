'use client';

import { useEffect, useState } from 'react';
import { BookMarked, Cable, ExternalLink, Filter, Plus, Trash2 } from 'lucide-react';
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

type TargetSystem = 'qbo' | 'xero';

interface GlMapping {
  id: string;
  glAccount: string;
  glAccountName: string | null;
  targetSystem: string;
  externalAccountCode: string;
  externalAccountName: string | null;
  isActive: boolean;
  createdAt: string;
}

interface GlExportJob {
  id: string;
  invoiceId: string;
  targetSystem: string;
  status: string;
  attempts: number;
  exportedAt: string | null;
  errorMessage: string | null;
  externalId: string | null;
  createdAt: string;
  invoice?: { internalNumber: string; invoiceNumber: string };
}

const SYSTEM_LABELS: Record<string, string> = {
  qbo: 'QuickBooks Online',
  xero: 'Xero',
};

const EMPTY_FORM = {
  glAccount: '',
  glAccountName: '',
  targetSystem: 'qbo' as TargetSystem,
  externalAccountCode: '',
  externalAccountName: '',
};

export default function GlMappingsPage() {
  const [activeTab, setActiveTab] = useState<'mappings' | 'jobs'>('mappings');
  const [mappings, setMappings] = useState<GlMapping[]>([]);
  const [jobs, setJobs] = useState<GlExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSystem, setFilterSystem] = useState<TargetSystem | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  async function loadMappings() {
    const data = await api.glMappings.list(filterSystem || undefined).catch(() => []);
    setMappings(data as GlMapping[]);
  }

  async function loadJobs() {
    const data = await api.glExportJobs.list().catch(() => []);
    setJobs(data as GlExportJob[]);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadMappings(), loadJobs()]).finally(() => setLoading(false));
  }, [filterSystem]);

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.glMappings.create({
        glAccount: form.glAccount,
        glAccountName: form.glAccountName || undefined,
        targetSystem: form.targetSystem,
        externalAccountCode: form.externalAccountCode,
        externalAccountName: form.externalAccountName || undefined,
      });
      setShowForm(false);
      setFormError('');
      setForm(EMPTY_FORM);
      await loadMappings();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create mapping');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this mapping?')) return;
    await api.glMappings.remove(id).catch(() => {});
    await loadMappings();
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="GL Integration"
        description="Map internal GL accounts to QuickBooks Online and Xero, then monitor how approved invoices move into export jobs."
        actions={
          <div className="flex gap-2 rounded-full border border-border/70 bg-background/80 p-1">
            <Button type="button" size="sm" variant={activeTab === 'mappings' ? 'default' : 'ghost'} onClick={() => setActiveTab('mappings')}>
              Account Mappings
            </Button>
            <Button type="button" size="sm" variant={activeTab === 'jobs' ? 'default' : 'ghost'} onClick={() => setActiveTab('jobs')}>
              Export Jobs
            </Button>
          </div>
        }
      />

      {activeTab === 'mappings' ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
            <Card className="rounded-[24px]">
              <CardHeader>
                <CardTitle className="text-xl">Mapping details</CardTitle>
                <CardDescription>Maintain the translation layer between internal chart-of-accounts values and the accounting system codes that exports require.</CardDescription>
              </CardHeader>
              <CardContent>
                {showForm ? (
                  <form onSubmit={handleCreate} className="space-y-5">
                    <div className="grid gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">GL account code</label>
                        <Input required value={form.glAccount} onChange={(event) => setField('glAccount', event.target.value)} placeholder="6000" />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">GL account name</label>
                        <Input value={form.glAccountName} onChange={(event) => setField('glAccountName', event.target.value)} placeholder="Office Supplies" />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">Target system</label>
                        <Select value={form.targetSystem} onChange={(event) => setField('targetSystem', event.target.value)} className="w-full">
                          <option value="qbo">QuickBooks Online</option>
                          <option value="xero">Xero</option>
                        </Select>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">External account code</label>
                        <Input required value={form.externalAccountCode} onChange={(event) => setField('externalAccountCode', event.target.value)} placeholder="200 or OFFSUPP" />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">External account name</label>
                        <Input value={form.externalAccountName} onChange={(event) => setField('externalAccountName', event.target.value)} placeholder="Name from the destination accounting system" />
                      </div>
                    </div>
                    {formError ? (
                      <Alert variant="destructive">
                        <AlertDescription>{formError}</AlertDescription>
                      </Alert>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={saving}>
                        <Plus className="h-4 w-4" />
                        {saving ? 'Saving...' : 'Save Mapping'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                    <Cable className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                    <div className="text-sm font-medium text-foreground">Chart-of-accounts bridge ready</div>
                    <p className="mt-2 text-sm text-muted-foreground">Create a mapping whenever a spend category needs to land in a new destination account.</p>
                    <div className="mt-5">
                      <Button type="button" onClick={() => setShowForm(true)}>
                        <Plus className="h-4 w-4" />
                        Add Mapping
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[24px]">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-xl">Account mappings</CardTitle>
                  <CardDescription>Filter by destination system and keep only active mappings that finance actually exports against.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={filterSystem} onChange={(event) => setFilterSystem(event.target.value as TargetSystem | '')} className="min-w-[11rem]">
                    <option value="">All systems</option>
                    <option value="qbo">QuickBooks Online</option>
                    <option value="xero">Xero</option>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {loading ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                    Loading mappings...
                  </div>
                ) : mappings.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                    No mappings configured. Add one to enable GL export on approved invoices.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>GL Account</TableHead>
                        <TableHead>GL Name</TableHead>
                        <TableHead>System</TableHead>
                        <TableHead>External Code</TableHead>
                        <TableHead>External Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappings.map((mapping) => (
                        <TableRow key={mapping.id}>
                          <TableCell>
                            <code className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">{mapping.glAccount}</code>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{mapping.glAccountName ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="border-border/80 bg-muted/40 text-muted-foreground">
                              {SYSTEM_LABELS[mapping.targetSystem] ?? mapping.targetSystem}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="inline-flex items-center gap-2 font-mono text-sm text-sky-700">
                              <ExternalLink className="h-3.5 w-3.5" />
                              {mapping.externalAccountCode}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{mapping.externalAccountName ?? '—'}</TableCell>
                          <TableCell>
                            <StatusBadge value={mapping.isActive ? 'active' : 'inactive'} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" onClick={() => handleDelete(mapping.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
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
        </>
      ) : (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Embedded export job feed</CardTitle>
            <CardDescription>This mirrors the live GL job history so finance can review mapping coverage and export outcomes without leaving the integration area.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                Loading export jobs...
              </div>
            ) : jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                <BookMarked className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">No export jobs yet</div>
                <p className="mt-2 text-sm text-muted-foreground">Approved invoices will start appearing here automatically once they are exported.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>System</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>External ID</TableHead>
                    <TableHead>Exported At</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium text-foreground">
                        {job.invoice?.internalNumber ?? job.invoiceId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{SYSTEM_LABELS[job.targetSystem] ?? job.targetSystem}</TableCell>
                      <TableCell>
                        <StatusBadge value={job.status} />
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{job.externalId ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.exportedAt ? new Date(job.exportedAt).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="max-w-[20rem] truncate text-sm text-rose-700">{job.errorMessage ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
