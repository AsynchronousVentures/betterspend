'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FolderClock, Save } from 'lucide-react';
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

interface Report {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  params?: { label: string; key: string; options: { label: string; value: string }[] }[];
}

interface SavedReport {
  id: string;
  name: string;
  reportType: string;
  filters: Record<string, unknown>;
  groupBy?: string;
  createdAt: string;
}

const REPORTS: Report[] = [
  {
    id: 'pos',
    title: 'Purchase Orders',
    description: 'All purchase orders with vendor, status, and amounts.',
    endpoint: '/reports/purchase-orders/csv',
    params: [
      {
        label: 'Status',
        key: 'status',
        options: [
          { label: 'All', value: '' },
          { label: 'Draft', value: 'draft' },
          { label: 'Pending Approval', value: 'pending_approval' },
          { label: 'Approved', value: 'approved' },
          { label: 'Issued', value: 'issued' },
          { label: 'Received', value: 'received' },
          { label: 'Cancelled', value: 'cancelled' },
        ],
      },
    ],
  },
  {
    id: 'invoices',
    title: 'Invoices',
    description: 'All invoices with match status, amounts, and approval info.',
    endpoint: '/reports/invoices/csv',
    params: [
      {
        label: 'Status',
        key: 'status',
        options: [
          { label: 'All', value: '' },
          { label: 'Pending Match', value: 'pending_match' },
          { label: 'Matched', value: 'matched' },
          { label: 'Exception', value: 'exception' },
          { label: 'Approved', value: 'approved' },
        ],
      },
    ],
  },
  {
    id: 'requisitions',
    title: 'Requisitions',
    description: 'All requisitions with department, priority, and totals.',
    endpoint: '/reports/requisitions/csv',
  },
  {
    id: 'spend',
    title: 'Spend Summary by Vendor',
    description: 'Aggregated spend per vendor from approved invoices.',
    endpoint: '/reports/spend-summary/csv',
  },
  {
    id: 'budgets',
    title: 'Budget Utilization',
    description: 'All budgets with allocated, spent, remaining, and utilization percentage.',
    endpoint: '/reports/budgets/csv',
  },
  {
    id: 'dept-spend',
    title: 'Department Spend',
    description: 'PO and requisition totals broken down by department.',
    endpoint: '/reports/department-spend/csv',
  },
  {
    id: 'ap-aging',
    title: 'AP Aging',
    description:
      'Overdue unpaid invoices grouped by aging bucket (0-30, 31-60, 61-90, 90+ days).',
    endpoint: '/reports/ap-aging/csv',
  },
  {
    id: 'grn',
    title: 'Goods Receipts',
    description: 'All GRNs with PO, vendor, received date, and quantities.',
    endpoint: '/reports/goods-receipts/csv',
  },
];

const REPORT_TYPES = [
  { value: 'spend_by_vendor', label: 'Spend by Vendor' },
  { value: 'spend_by_department', label: 'Spend by Department' },
  { value: 'spend_by_category', label: 'Spend by Category' },
  { value: 'po_status_summary', label: 'PO Status Summary' },
  { value: 'invoice_aging', label: 'Invoice Aging' },
  { value: 'approval_cycle_time', label: 'Approval Cycle Time' },
];

const DATE_RANGES = [
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'last12months', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom range' },
];

const GROUP_BY_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'month', label: 'By Month' },
  { value: 'quarter', label: 'By Quarter' },
  { value: 'vendor', label: 'By Vendor' },
  { value: 'department', label: 'By Department' },
];

function getDateRange(preset: string): { startDate?: string; endDate?: string } {
  const now = new Date();
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  if (preset === 'last30') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { startDate: fmt(start), endDate: fmt(now) };
  }
  if (preset === 'last90') {
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    return { startDate: fmt(start), endDate: fmt(now) };
  }
  if (preset === 'last12months') {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    return { startDate: fmt(start), endDate: fmt(now) };
  }
  return {};
}

function SaveModal({
  onSave,
  onClose,
}: {
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[24px] border border-border/70 bg-card p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">Save Report</div>
        <div className="mt-5">
          <label className="mb-2 block text-sm font-medium text-foreground">Report name</label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Monthly Vendor Spend"
            autoFocus
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!name.trim()}
            onClick={() => onSave(name.trim())}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
        No data found for the selected criteria.
      </div>
    );
  }

  const headers = Object.keys(rows[0]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((header) => (
            <TableHead key={header}>{header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {headers.map((header) => (
              <TableCell key={header} className="text-muted-foreground">
                {row[header] == null ? '—' : String(row[header])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, Record<string, string>>>({});

  const [reportType, setReportType] = useState('spend_by_vendor');
  const [dateRange, setDateRange] = useState('last30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  const loadSavedReports = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const list = await api.reports.savedReports.list();
      setSavedReports(list);
    } catch {
      // ignore
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    loadSavedReports();
  }, [loadSavedReports]);

  function setParam(reportId: string, key: string, value: string) {
    setParams((current) => ({
      ...current,
      [reportId]: { ...(current[reportId] || {}), [key]: value },
    }));
  }

  async function download(report: Report) {
    setDownloading(report.id);
    try {
      const reportParams = params[report.id] || {};
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(reportParams)) {
        if (value) filtered[key] = value;
      }
      const res = await api.reports.download(report.endpoint.replace('/reports/', ''), filtered);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objUrl;
      anchor.download = `${report.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(objUrl);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  }

  function buildParams() {
    const dates =
      dateRange === 'custom'
        ? { startDate: customStart || undefined, endDate: customEnd || undefined }
        : getDateRange(dateRange);

    return {
      reportType,
      ...dates,
      groupBy: groupBy || undefined,
    };
  }

  async function runReport() {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const rows = await api.reports.customReport(buildParams());
      setResults(rows);
    } catch (err: any) {
      setError(err.message || 'Failed to run report');
    } finally {
      setRunning(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await api.reports.customReportCsv(buildParams());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objUrl;
      anchor.download = `${reportType}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(objUrl);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function saveReport(name: string) {
    const { startDate, endDate } =
      dateRange === 'custom'
        ? { startDate: customStart || undefined, endDate: customEnd || undefined }
        : getDateRange(dateRange);

    await api.reports.savedReports.save({
      name,
      reportType,
      filters: {
        dateRange,
        startDate,
        endDate,
      },
      groupBy: groupBy || undefined,
    });
    setShowSaveModal(false);
    loadSavedReports();
  }

  async function runSavedReport(report: SavedReport) {
    const filters = report.filters as {
      dateRange?: string;
      startDate?: string;
      endDate?: string;
    };
    const dates =
      filters.dateRange && filters.dateRange !== 'custom'
        ? getDateRange(filters.dateRange)
        : { startDate: filters.startDate, endDate: filters.endDate };

    setReportType(report.reportType);
    setGroupBy(report.groupBy ?? '');
    setDateRange(filters.dateRange ?? 'last30');
    if (filters.dateRange === 'custom') {
      setCustomStart(filters.startDate ?? '');
      setCustomEnd(filters.endDate ?? '');
    }

    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const rows = await api.reports.customReport({
        reportType: report.reportType,
        ...dates,
        groupBy: report.groupBy || undefined,
      });
      setResults(rows);
    } catch (err: any) {
      setError(err.message || 'Failed to run report');
    } finally {
      setRunning(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteSavedReport(id: string) {
    try {
      await api.reports.savedReports.delete(id);
      setSavedReports((current) => current.filter((report) => report.id !== id));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  const reportTypeLabel =
    REPORT_TYPES.find((report) => report.value === reportType)?.label ?? reportType;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Reports"
        description="Build custom reports, export raw operational data as CSV, and save repeat report configurations for one-click reruns."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4" />
            Reporting workspace
          </div>
        }
      />

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Custom Report Builder</CardTitle>
          <CardDescription>Choose a report type, date range, grouping, and run or export the result directly from the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Report Type">
              <Select value={reportType} onChange={(event) => setReportType(event.target.value)} className="w-full">
                {REPORT_TYPES.map((report) => (
                  <option key={report.value} value={report.value}>
                    {report.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date Range">
              <Select value={dateRange} onChange={(event) => setDateRange(event.target.value)} className="w-full">
                {DATE_RANGES.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Group By">
              <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} className="w-full">
                {GROUP_BY_OPTIONS.map((group) => (
                  <option key={group.value} value={group.value}>
                    {group.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {dateRange === 'custom' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Start Date">
                <Input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              </Field>
              <Field label="End Date">
                <Input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </Field>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={runReport} disabled={running}>
              {running ? 'Running...' : 'Run Report'}
            </Button>
            <Button type="button" variant="outline" onClick={exportCsv} disabled={exporting}>
              <Download className="h-4 w-4" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowSaveModal(true)}>
              <Save className="h-4 w-4" />
              Save Report
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {results !== null ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">
                {reportTypeLabel} · {results.length} row{results.length !== 1 ? 's' : ''}
              </div>
              <ResultTable rows={results} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Saved Reports</CardTitle>
          <CardDescription>Store frequently used report definitions and rerun them with a single click.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingSaved ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
              Loading saved reports...
            </div>
          ) : savedReports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
              <FolderClock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <div className="text-sm font-medium text-foreground">No saved reports yet</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Run a report and save it to store that configuration for later.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedReports.map((report) => {
                const label =
                  REPORT_TYPES.find((type) => type.value === report.reportType)?.label ??
                  report.reportType;
                return (
                  <div
                    key={report.id}
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{report.name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {label}
                        {report.groupBy ? ` · grouped by ${report.groupBy}` : ''}
                        {' · saved '}
                        {new Date(report.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => runSavedReport(report)}>
                        Run
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => deleteSavedReport(report.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Standard Exports</CardTitle>
          <CardDescription>Download raw CSV extracts for downstream analysis in spreadsheets or BI tools.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {REPORTS.map((report) => (
            <div
              key={report.id}
              className="rounded-2xl border border-border/70 bg-muted/20 p-4"
            >
              <div className="text-base font-semibold text-foreground">{report.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>

              {report.params?.length ? (
                <div className="mt-4 grid gap-3">
                  {report.params.map((param) => (
                    <Field key={`${report.id}-${param.key}`} label={param.label}>
                      <Select
                        value={params[report.id]?.[param.key] ?? ''}
                        onChange={(event) => setParam(report.id, param.key, event.target.value)}
                        className="w-full"
                      >
                        {param.options.map((option) => (
                          <option key={option.label} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              ) : null}

              <div className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => download(report)}
                  disabled={downloading === report.id}
                >
                  <Download className="h-4 w-4" />
                  {downloading === report.id ? 'Downloading...' : 'Download CSV'}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {showSaveModal ? (
        <SaveModal onSave={saveReport} onClose={() => setShowSaveModal(false)} />
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
