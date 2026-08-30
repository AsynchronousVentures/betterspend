'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Cable, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { GlExportHistory } from '../../components/gl-export-history';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
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
import { QboMappingWorkbench } from './qbo-mapping-workbench';

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

const SYSTEM_LABELS: Record<string, string> = {
  qbo: 'QuickBooks Online',
  xero: 'Xero',
};

const EMPTY_FORM = {
  glAccount: '',
  glAccountName: '',
  targetSystem: 'xero' as TargetSystem,
  externalAccountCode: '',
  externalAccountName: '',
};

function GlMappingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab =
    searchParams.get('view') === 'export-history'
      ? 'jobs'
      : searchParams.get('view') === 'xero'
        ? 'xero'
        : 'qbo';
  const [mappings, setMappings] = useState<GlMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const filterSystem: TargetSystem = 'xero';
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  async function loadMappings() {
    try {
      const data = await api.glMappings.list(filterSystem || undefined);
      setMappings(data as GlMapping[]);
      setLoadError('');
    } catch (err) {
      setMappings([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load GL mappings');
    }
  }

  useEffect(() => {
    if (activeTab !== 'xero') return;
    setLoading(true);
    loadMappings().finally(() => setLoading(false));
  }, [activeTab, filterSystem]);

  function selectView(view: 'qbo' | 'xero' | 'jobs') {
    const params = new URLSearchParams(searchParams.toString());
    if (view === 'jobs') {
      params.set('view', 'export-history');
    } else if (view === 'xero') {
      params.set('view', 'xero');
    } else {
      params.delete('view');
    }
    params.delete('targetSystem');
    const query = params.toString();
    router.replace(`/gl-mappings${query ? `?${query}` : ''}`);
  }

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
        title="Accounting Integration"
        description="Link BetterSpend records to synced accounting catalogs and monitor approved invoice exports."
        actions={
          <div className="flex border-b border-border/70">
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'qbo' ? 'default' : 'ghost'}
              className="rounded-none"
              onClick={() => selectView('qbo')}
            >
              QBO Mappings
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'xero' ? 'default' : 'ghost'}
              className="rounded-none"
              onClick={() => selectView('xero')}
            >
              Xero Accounts
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'jobs' ? 'default' : 'ghost'}
              className="rounded-none"
              onClick={() => selectView('jobs')}
            >
              Export History
            </Button>
          </div>
        }
      />

      {activeTab === 'xero' && loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {activeTab === 'qbo' ? (
        <QboMappingWorkbench />
      ) : activeTab === 'xero' ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="text-xl">Mapping details</CardTitle>
                <CardDescription>
                  Maintain the translation layer between internal chart-of-accounts values and the
                  accounting system codes that exports require.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {showForm ? (
                  <form onSubmit={handleCreate} className="space-y-5">
                    <div className="grid gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          GL account code
                        </label>
                        <Input
                          required
                          value={form.glAccount}
                          onChange={(event) => setField('glAccount', event.target.value)}
                          placeholder="6000"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          GL account name
                        </label>
                        <Input
                          value={form.glAccountName}
                          onChange={(event) => setField('glAccountName', event.target.value)}
                          placeholder="Office Supplies"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Target system
                        </label>
                        <Select
                          value={form.targetSystem}
                          onChange={(event) => setField('targetSystem', event.target.value)}
                          className="w-full"
                          disabled
                        >
                          <option value="xero">Xero</option>
                        </Select>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          External account code
                        </label>
                        <Input
                          required
                          value={form.externalAccountCode}
                          onChange={(event) => setField('externalAccountCode', event.target.value)}
                          placeholder="200 or OFFSUPP"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          External account name
                        </label>
                        <Input
                          value={form.externalAccountName}
                          onChange={(event) => setField('externalAccountName', event.target.value)}
                          placeholder="Name from the destination accounting system"
                        />
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
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                    <Cable className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                    <div className="text-sm font-medium text-foreground">
                      Chart-of-accounts bridge ready
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Create a mapping whenever a spend category needs to land in a new destination
                      account.
                    </p>
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

            <Card className="rounded-lg">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-xl">Account mappings</CardTitle>
                  <CardDescription>
                    Keep only active mappings that finance actually exports against.
                  </CardDescription>
                </div>
                <Badge variant="outline">Xero</Badge>
              </CardHeader>
              <CardContent className="pt-0">
                {loading ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                    Loading mappings...
                  </div>
                ) : mappings.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
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
                            <code className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                              {mapping.glAccount}
                            </code>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {mapping.glAccountName ?? '—'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="border-border/80 bg-muted/40 text-muted-foreground"
                            >
                              {SYSTEM_LABELS[mapping.targetSystem] ?? mapping.targetSystem}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="inline-flex items-center gap-2 font-mono text-sm text-sky-700">
                              <ExternalLink className="h-3.5 w-3.5" />
                              {mapping.externalAccountCode}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {mapping.externalAccountName ?? '—'}
                          </TableCell>
                          <TableCell>
                            <StatusBadge value={mapping.isActive ? 'active' : 'inactive'} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(mapping.id)}
                            >
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
        <GlExportHistory selectedJobId={searchParams.get('job')} />
      )}
    </div>
  );
}

export default function GlMappingsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground lg:p-8">Loading GL Integration...</div>
      }
    >
      <GlMappingsContent />
    </Suspense>
  );
}
