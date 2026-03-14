'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const ENTITY_TYPES = ['requisition', 'purchase_order', 'invoice', 'goods_receipt', 'budget', 'vendor', 'user'];

async function downloadCsv(type: string) {
  const { api: exportApi } = await import('../../lib/api');
  const res = await exportApi.export.download(type);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `export-${type}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    load();
  }, [filterEntity]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.audit.list({ entityType: filterEntity || undefined, limit: 200 });
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      await downloadCsv('audit-log');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">Audit Log</h1>
          <p className="mt-2 text-sm text-muted-foreground">Immutable record of all system actions.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleExportCsv} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Entity type:</span>
        <Select value={filterEntity} onChange={(event) => setFilterEntity(event.target.value)} className="min-w-[180px]">
          <option value="">All</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{entries.length} entries</span>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No audit entries found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const isExpanded = expanded === entry.id;
                  const hasChanges = entry.changes && Object.keys(entry.changes).length > 0;
                  return (
                    <>
                      <TableRow
                        key={entry.id}
                        className={hasChanges ? 'cursor-pointer' : undefined}
                        onClick={() => hasChanges && setExpanded(isExpanded ? null : entry.id)}
                      >
                        <TableCell className="text-sm text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">{entry.entityType.replace('_', ' ')}</TableCell>
                        <TableCell className="capitalize text-foreground">{entry.action}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{entry.entityId.slice(0, 8)}...</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{entry.userId ? `${entry.userId.slice(0, 8)}...` : '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{hasChanges ? (isExpanded ? '▲' : '▼') : ''}</TableCell>
                      </TableRow>
                      {isExpanded && hasChanges ? (
                        <TableRow key={`${entry.id}-detail`}>
                          <TableCell colSpan={6}>
                            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/40 p-4 text-xs text-muted-foreground">
                              {JSON.stringify(entry.changes, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
