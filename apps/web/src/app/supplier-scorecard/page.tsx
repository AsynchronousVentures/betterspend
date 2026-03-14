'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Medal, Truck } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

interface ScorecardRow {
  vendorId: string;
  vendorName: string;
  overallScore: number;
  deliveryScore: number;
  qualityScore: number;
  priceScore: number;
  invoiceAccuracyScore: number;
  totalPos: number;
  totalInvoices: number;
}

interface ScorecardDetail {
  vendor: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
  scores: {
    overallScore: number;
    deliveryScore: number;
    qualityScore: number;
    priceScore: number;
    invoiceAccuracyScore: number;
    totalPos: number;
    totalInvoices: number;
  };
  trend: Array<{ month: string; invoiceAccuracy: number; priceScore: number }>;
  recentPos: Array<{
    id: string;
    poNumber: string;
    status: string;
    totalAmount: string;
    issuedAt: string | null;
    expectedDeliveryDate: string | null;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    matchStatus: string | null;
    totalAmount: string;
    invoiceDate: string;
  }>;
}

function scoreBadgeClasses(score: number) {
  if (score >= 80) return 'border-emerald-200 bg-emerald-100 text-emerald-800';
  if (score >= 60) return 'border-amber-200 bg-amber-100 text-amber-800';
  return 'border-rose-200 bg-rose-100 text-rose-800';
}

function fmt(n: string | number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

export default function SupplierScorecardPage() {
  const [rows, setRows] = useState<ScorecardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScorecardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sortField, setSortField] = useState<keyof ScorecardRow>('overallScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    api.supplierScorecard
      .list()
      .then((data) => setRows(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function handleRowClick(vendorId: string) {
    if (selectedVendorId === vendorId) {
      setSelectedVendorId(null);
      setDetail(null);
      return;
    }
    setSelectedVendorId(vendorId);
    setDetail(null);
    setDetailLoading(true);
    api.supplierScorecard
      .get(vendorId)
      .then((data) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }

  function handleSort(field: keyof ScorecardRow) {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const columns: Array<{ key: keyof ScorecardRow; label: string }> = [
    { key: 'vendorName', label: 'Vendor' },
    { key: 'overallScore', label: 'Overall' },
    { key: 'deliveryScore', label: 'Delivery' },
    { key: 'invoiceAccuracyScore', label: 'Invoice Accuracy' },
    { key: 'priceScore', label: 'Price' },
    { key: 'qualityScore', label: 'Quality' },
    { key: 'totalPos', label: 'POs' },
    { key: 'totalInvoices', label: 'Invoices' },
  ];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Supplier Scorecard"
        description="Vendor reliability scores based on delivery, invoice accuracy, pricing, and quality signals drawn from operational history."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Medal className="h-4 w-4" />
            Ranked suppliers
          </div>
        }
      />

      <div className="flex flex-wrap gap-3">
        <LegendBadge label="Excellent (80+)" className="border-emerald-200 bg-emerald-100 text-emerald-800" />
        <LegendBadge label="Good (60-79)" className="border-amber-200 bg-amber-100 text-amber-800" />
        <LegendBadge label="Needs Attention (<60)" className="border-rose-200 bg-rose-100 text-rose-800" />
      </div>

      {loading ? (
        <EmptyCard text="Loading supplier scores..." />
      ) : error ? (
        <EmptyCard text={`Error: ${error}`} />
      ) : rows.length === 0 ? (
        <EmptyCard text="No vendor data yet. Scores appear once vendors have purchase orders or invoices." />
      ) : (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Scoreboard</CardTitle>
            <CardDescription>Click a vendor row to expand operational detail and see the latest PO and invoice activity behind the score.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className="cursor-pointer select-none"
                      onClick={() => handleSort(column.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {column.label}
                        {sortField === column.key ? (
                          <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        ) : null}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => {
                  const isSelected = row.vendorId === selectedVendorId;
                  return (
                    <>
                      <TableRow
                        key={row.vendorId}
                        onClick={() => handleRowClick(row.vendorId)}
                        className={isSelected ? 'bg-sky-50 hover:bg-sky-50' : 'cursor-pointer'}
                      >
                        <TableCell className="font-medium text-foreground">
                          <div className="flex items-center justify-between gap-3">
                            <span>{row.vendorName}</span>
                            {isSelected ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ScoreBadge score={row.overallScore} />
                        </TableCell>
                        <TableCell>
                          <ScoreBadge score={row.deliveryScore} />
                        </TableCell>
                        <TableCell>
                          <ScoreBadge score={row.invoiceAccuracyScore} />
                        </TableCell>
                        <TableCell>
                          <ScoreBadge score={row.priceScore} />
                        </TableCell>
                        <TableCell>
                          <ScoreBadge score={row.qualityScore} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.totalPos}</TableCell>
                        <TableCell className="text-muted-foreground">{row.totalInvoices}</TableCell>
                      </TableRow>

                      {isSelected ? (
                        <TableRow key={`${row.vendorId}-detail`} className="hover:bg-transparent">
                          <TableCell colSpan={8} className="bg-sky-50/70">
                            {detailLoading ? (
                              <div className="py-4 text-sm text-muted-foreground">Loading details...</div>
                            ) : detail ? (
                              <DetailPanel detail={detail} />
                            ) : (
                              <div className="py-4 text-sm text-muted-foreground">No detail available.</div>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailPanel({ detail }: { detail: ScorecardDetail }) {
  const scores = detail.scores;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="border-border/70 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Score Breakdown</CardTitle>
          <CardDescription>{detail.vendor.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScoreBar score={scores.deliveryScore} label="Delivery (30%)" />
          <ScoreBar score={scores.invoiceAccuracyScore} label="Invoice Accuracy (30%)" />
          <ScoreBar score={scores.priceScore} label="Price (25%)" />
          <ScoreBar score={scores.qualityScore} label="Quality (15%)" />
          <div className="flex items-center justify-between border-t border-border/70 pt-4">
            <span className="text-sm font-medium text-foreground">Overall Score</span>
            <ScoreBadge score={scores.overallScore} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Purchase Orders" value={String(scores.totalPos)} />
            <MiniStat label="Invoices" value={String(scores.totalInvoices)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Recent Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.recentPos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
          ) : (
            <div className="space-y-3">
              {detail.recentPos.map((po) => (
                <div key={po.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{po.poNumber}</div>
                    <StatusChip status={po.status} />
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {fmt(po.totalAmount)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {po.expectedDeliveryDate ? `Due ${fmtDate(po.expectedDeliveryDate)}` : 'No delivery date'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="space-y-3">
              {detail.recentInvoices.map((invoice) => (
                <div key={invoice.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{invoice.invoiceNumber}</div>
                    <MatchChip matchStatus={invoice.matchStatus} />
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {fmt(invoice.totalAmount)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{fmtDate(invoice.invoiceDate)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`inline-flex min-w-[42px] items-center justify-center rounded-full border px-2 py-1 text-xs font-bold ${scoreBadgeClasses(
        score,
      )}`}
    >
      {score}
    </span>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const tone =
    score >= 80 ? '#15803d' : score >= 60 ? '#b45309' : '#be123c';

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold" style={{ color: tone }}>
          {score}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className="h-2 rounded-full transition-[width]"
          style={{ width: `${Math.min(score, 100)}%`, backgroundColor: tone }}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const classes: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    pending_approval: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    issued: 'bg-sky-100 text-sky-800',
    partially_received: 'bg-lime-100 text-lime-800',
    received: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-rose-100 text-rose-800',
  };

  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${classes[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function MatchChip({ matchStatus }: { matchStatus: string | null }) {
  if (!matchStatus) return <span className="text-[11px] text-muted-foreground">—</span>;

  const classes: Record<string, string> = {
    full_match: 'bg-emerald-100 text-emerald-800',
    partial_match: 'bg-amber-100 text-amber-800',
    exception: 'bg-rose-100 text-rose-800',
  };

  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${classes[matchStatus] ?? 'bg-slate-100 text-slate-700'}`}>
      {matchStatus.replace(/_/g, ' ')}
    </span>
  );
}

function LegendBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card className="rounded-[24px]">
      <CardContent className="p-8 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}
