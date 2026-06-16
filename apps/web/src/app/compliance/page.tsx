'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileJson,
  Printer,
  RefreshCw,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
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

type ChecklistItem = {
  id: string;
  category: string;
  label: string;
  evidence: string;
};

type Preview = {
  manifest: {
    framework: string;
    generatedAt: string;
    period: { from: string; to: string };
    counts: {
      auditEntries: number;
      users: number;
      approvalEvidenceRows: number;
    };
    includedFiles: string[];
  };
  recentAuditEntries: Array<Record<string, any>>;
  userRosterSample: Array<Record<string, any>>;
  approvalSample: Array<Record<string, any>>;
  retentionSummary: {
    dataSets: Array<{
      dataSet: string;
      recordCount: number;
      oldestRecord: string | null;
      newestRecord: string | null;
    }>;
  };
};

const CHECKLIST_KEY = 'betterspend:compliance-checklist';

const CHECKLIST: ChecklistItem[] = [
  {
    id: 'mfa-enabled',
    category: 'Authentication',
    label: 'MFA policy documented for administrators',
    evidence: 'Workspace security policy or IdP configuration',
  },
  {
    id: 'session-timeout',
    category: 'Authentication',
    label: 'Session timeout and password reset process reviewed',
    evidence: 'Security settings screenshot or policy note',
  },
  {
    id: 'least-privilege',
    category: 'Access Control',
    label: 'Least-privilege roles assigned to active users',
    evidence: 'User roster export',
  },
  {
    id: 'admin-review',
    category: 'Access Control',
    label: 'Admin user list reviewed this quarter',
    evidence: 'User roster export plus reviewer signoff',
  },
  {
    id: 'backups',
    category: 'Data',
    label: 'Database backups are configured and restore-tested',
    evidence: 'Backup job log and restore test result',
  },
  {
    id: 'encryption',
    category: 'Data',
    label: 'Database and document storage encryption verified',
    evidence: 'Infrastructure configuration evidence',
  },
  {
    id: 'https',
    category: 'Network',
    label: 'HTTPS enforced at the public entry point',
    evidence: 'Reverse proxy or load balancer configuration',
  },
  {
    id: 'private-api',
    category: 'Network',
    label: 'API and storage services are not publicly exposed unnecessarily',
    evidence: 'Firewall, security group, or network policy review',
  },
  {
    id: 'audit-retention',
    category: 'Audit',
    label: 'Audit log retention period documented',
    evidence: 'Data retention policy',
  },
  {
    id: 'audit-export-tested',
    category: 'Audit',
    label: 'Audit evidence package export tested',
    evidence: 'Generated package retained with test date',
  },
];

function defaultDateRange() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 90);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'None';
  return new Date(value).toLocaleString();
}

function countByCategory(done: Record<string, boolean>) {
  return CHECKLIST.reduce<Record<string, { done: number; total: number }>>((acc, item) => {
    acc[item.category] ??= { done: 0, total: 0 };
    acc[item.category].total += 1;
    if (done[item.id]) acc[item.category].done += 1;
    return acc;
  }, {});
}

export default function CompliancePage() {
  const initialRange = useMemo(defaultDateRange, []);
  const [framework, setFramework] = useState('soc2');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [gdprBusy, setGdprBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextPreview, nextUsers] = await Promise.all([
        api.compliance.previewAuditPackage({ framework, from, to }),
        api.users.list(),
      ]);
      setPreview(nextPreview);
      setUsers(nextUsers);
      if (!selectedUserId && nextUsers[0]?.id) setSelectedUserId(nextUsers[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [framework, from, to, selectedUserId]);

  useEffect(() => {
    const saved = window.localStorage.getItem(CHECKLIST_KEY);
    if (saved) {
      try {
        setChecklistState(JSON.parse(saved));
      } catch {
        setChecklistState({});
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleChecklist(id: string) {
    setChecklistState((current) => {
      const next = { ...current, [id]: !current[id] };
      window.localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function handleGeneratePackage() {
    setGenerating(true);
    setMessage('');
    setError('');
    try {
      const response = await api.compliance.downloadAuditPackage({ framework, from, to });
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ message: 'Failed to generate package' }));
        throw new Error(payload.message || 'Failed to generate package');
      }
      const blob = await response.blob();
      downloadBlob(
        blob,
        filenameFromDisposition(
          response.headers.get('content-disposition'),
          `betterspend-${framework}-audit-package.zip`,
        ),
      );
      setMessage('Audit evidence package generated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate package');
    } finally {
      setGenerating(false);
    }
  }

  async function handleGdprExport() {
    if (!selectedUserId) return;
    setGdprBusy(true);
    setMessage('');
    setError('');
    try {
      const data = await api.compliance.gdprExport(selectedUserId);
      const subject = data?.subject?.email || selectedUserId;
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `gdpr-export-${subject}-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setMessage('GDPR data export generated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export user data');
    } finally {
      setGdprBusy(false);
    }
  }

  async function handlePseudonymize() {
    if (!selectedUserId) return;
    const selected = users.find((user) => user.id === selectedUserId);
    const label = selected?.email || selectedUserId;
    if (
      !window.confirm(
        `Pseudonymize ${label}? This revokes active sessions and replaces personal identifiers.`,
      )
    ) {
      return;
    }

    setGdprBusy(true);
    setMessage('');
    setError('');
    try {
      await api.compliance.gdprDelete(selectedUserId);
      setMessage('User personal identifiers were pseudonymized.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pseudonymize user');
    } finally {
      setGdprBusy(false);
    }
  }

  const checklistDone = CHECKLIST.filter((item) => checklistState[item.id]).length;
  const checklistByCategory = countByCategory(checklistState);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Compliance"
        description="Audit evidence, GDPR data subject exports, and self-hosting hardening readiness."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={handleGeneratePackage} disabled={generating}>
              <Download className="mr-2 h-4 w-4" />
              {generating ? 'Generating...' : 'Audit Package'}
            </Button>
          </>
        }
      />

      {message ? (
        <Alert variant="success">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Audit Entries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-[-0.03em]">
              {preview?.manifest.counts.auditEntries ?? 0}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Selected period</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">User Roster</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-[-0.03em]">
              {preview?.manifest.counts.users ?? 0}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Included users</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-[-0.03em]">
              {checklistDone}/{CHECKLIST.length}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Local readiness items</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle>Audit Evidence Package</CardTitle>
                  <CardDescription>
                    ZIP export with audit log, user roster, approval evidence, and retention
                    summary.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="capitalize">
                  {framework}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Framework</span>
                  <Select
                    value={framework}
                    onChange={(event) => setFramework(event.target.value)}
                    className="w-full"
                  >
                    <option value="soc2">SOC 2</option>
                    <option value="iso27001">ISO 27001</option>
                    <option value="custom">Custom</option>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">From</span>
                  <Input
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">To</span>
                  <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
                <Button variant="outline" onClick={load} disabled={loading}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Preview
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {preview?.manifest.includedFiles.map((file) => (
                  <div
                    key={file}
                    className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">{file}</span>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Entity</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : preview?.recentAuditEntries.length ? (
                      preview.recentAuditEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="capitalize">
                            {String(entry.entityType).replace('_', ' ')}
                          </TableCell>
                          <TableCell>{entry.action}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {entry.userId ? `${entry.userId.slice(0, 8)}...` : 'System'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          No audit entries in this period.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Subject Requests</CardTitle>
              <CardDescription>
                Export user data or pseudonymize personal identifiers in non-audit records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Subject user</span>
                  <Select
                    value={selectedUserId}
                    onChange={(event) => setSelectedUserId(event.target.value)}
                    className="w-full"
                  >
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} · {user.email}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button
                  variant="outline"
                  onClick={handleGdprExport}
                  disabled={!selectedUserId || gdprBusy}
                >
                  <FileJson className="mr-2 h-4 w-4" />
                  Export JSON
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePseudonymize}
                  disabled={!selectedUserId || gdprBusy}
                >
                  <UserX className="mr-2 h-4 w-4" />
                  Pseudonymize
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Hardening Checklist</CardTitle>
                  <CardDescription>Stored locally in this browser.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(checklistByCategory).map(([category, counts]) => (
                  <div
                    key={category}
                    className="rounded-md border border-border/70 bg-muted/20 p-3"
                  >
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {category}
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {counts.done}/{counts.total}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {CHECKLIST.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer gap-3 rounded-md border border-border/70 bg-card px-3 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(checklistState[item.id])}
                      onChange={() => toggleChecklist(item.id)}
                      className="mt-1 h-4 w-4 rounded border-input"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.evidence}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Retention Snapshot</CardTitle>
                  <CardDescription>Record ranges included in the evidence set.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {preview?.retentionSummary.dataSets.map((row) => (
                  <div key={row.dataSet} className="rounded-md border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">
                        {row.dataSet.replace('_', ' ')}
                      </div>
                      <Badge variant="subtle">{row.recordCount}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatDate(row.oldestRecord)} - {formatDate(row.newestRecord)}
                    </div>
                  </div>
                )) ?? (
                  <div className="text-sm text-muted-foreground">No retention data loaded.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
