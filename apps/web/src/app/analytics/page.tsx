'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, BarChart3, Building2, ReceiptText, TimerReset, Wallet } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
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
import { Badge } from '../../components/ui/badge';

function fmt(n: string | number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtN(n: string | number | null | undefined, dp = 1) {
  if (n == null) return '—';
  return Number(n).toFixed(dp);
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

interface KpiData {
  purchaseOrders: { total: number; active: number; totalValue: string };
  requisitions: { total: number };
  invoices: { total: number; paid: string; pending: string };
  budgets: { totalBudget: string };
}

interface VendorRow {
  vendorId: string;
  vendorName: string;
  total: string;
  invoiceCount: number;
}

interface DeptRow {
  department: string;
  total: string;
  poCount: number;
}

interface MonthRow {
  month: string;
  total: string;
  invoiceCount: number;
}

interface AgingRow {
  bucket: string;
  count: number;
  total: string;
}

interface CycleRow {
  avgDays: string | null;
  minDays: string | null;
  maxDays: string | null;
  poCount: number;
}

interface VendorPerfRow {
  vendorId: string;
  vendorName: string;
  invoiceCount: number;
  exceptionCount: number;
  exceptionRate: string | null;
  avgDaysToApprove: string | null;
  totalApproved: string;
  poCount: number;
}

interface BudgetUtilRow {
  budgetId: string;
  budgetName: string;
  budgetType: string;
  fiscalYear: number;
  totalAmount: string;
  spentAmount: string;
  utilizationPct: string | null;
  remaining: string;
  departmentName: string | null;
  projectName: string | null;
}

const AGING_COLORS: Record<string, string> = {
  '0-30 days': '#22c55e',
  '31-60 days': '#f59e0b',
  '61-90 days': '#f97316',
  '90+ days': '#e11d48',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-2 text-xs shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)]">
      {label ? <div className="mb-1 font-medium text-muted-foreground">{label}</div> : null}
      {payload.map((point: any, index: number) => (
        <div key={index} className="font-semibold" style={{ color: point.color ?? 'hsl(var(--foreground))' }}>
          {point.name ? `${point.name}: ` : ''}
          {typeof point.value === 'number' ? fmtShort(point.value) : point.value}
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [monthly, setMonthly] = useState<MonthRow[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [cycle, setCycle] = useState<CycleRow | null>(null);
  const [vendPerf, setVendPerf] = useState<VendorPerfRow[]>([]);
  const [budgetUtil, setBudgetUtil] = useState<BudgetUtilRow[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.analytics.kpis() as Promise<KpiData>,
      api.analytics.spendByVendor() as Promise<VendorRow[]>,
      api.analytics.spendByDepartment() as Promise<DeptRow[]>,
      api.analytics.monthlySpend() as Promise<MonthRow[]>,
      api.analytics.invoiceAging() as Promise<AgingRow[]>,
      api.analytics.poCycleTime() as Promise<CycleRow>,
      api.analytics.vendorPerformance() as Promise<VendorPerfRow[]>,
      api.analytics.budgetUtilization() as Promise<BudgetUtilRow[]>,
      api.analytics.spendByCategory(),
      api.analytics.spendAnomalies(),
    ])
      .then(([k, v, d, m, a, c, vp, bu, cat, anom]) => {
        setKpis(k);
        setVendors(v);
        setDepts(d);
        setMonthly(m);
        setAging(a);
        setCycle(c);
        setVendPerf(vp);
        setBudgetUtil(bu);
        setCategories(cat);
        setAnomalies(anom);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading analytics...</div>;
  }

  const monthlyChartData = monthly.map((month) => ({
    month: month.month.slice(5),
    total: Number(month.total),
    invoices: month.invoiceCount,
  }));

  const vendorChartData = vendors.slice(0, 10).map((vendor) => ({
    name: vendor.vendorName.length > 20 ? `${vendor.vendorName.slice(0, 18)}…` : vendor.vendorName,
    total: Number(vendor.total),
    invoices: vendor.invoiceCount,
  }));

  const agingChartData = aging.map((row) => ({
    bucket: row.bucket.replace(' days', '').replace('-', '–'),
    count: row.count,
    total: Number(row.total),
    color: AGING_COLORS[row.bucket] ?? '#94a3b8',
  }));

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Analytics"
        description="Spend intelligence, operational throughput, budget utilization, and anomaly spotting across the procurement workflow."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            Live metrics
          </div>
        }
      />

      {kpis ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            icon={ReceiptText}
            label="Active POs"
            value={String(kpis.purchaseOrders.active ?? 0)}
            sub={`${kpis.purchaseOrders.total} total`}
          />
          <KpiTile
            icon={Wallet}
            label="PO Spend"
            value={fmt(kpis.purchaseOrders.totalValue)}
            sub="all time"
          />
          <KpiTile
            icon={Building2}
            label="Invoices Paid"
            value={fmt(kpis.invoices.paid)}
            sub={`${fmt(kpis.invoices.pending)} pending`}
          />
          <KpiTile
            icon={TimerReset}
            label="Budget (active)"
            value={fmt(kpis.budgets.totalBudget)}
            sub={`${kpis.requisitions.total} active reqs`}
          />
        </div>
      ) : null}

      <ChartCard
        title="Monthly Spend Trend"
        description="Approved invoice volume over the last 12 months."
      >
        {monthlyChartData.length === 0 ? (
          <Empty text="No approved invoices in the past 12 months." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="total"
                stroke="#0f766e"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#0f766e', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#134e4a' }}
                name="Spend"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ChartCard title="Spend by Vendor" description="Top 10 vendors by approved invoice spend.">
          {vendorChartData.length === 0 ? (
            <Empty text="No approved invoices yet." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(vendorChartData.length * 36, 180)}>
              <BarChart layout="vertical" data={vendorChartData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={110} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" fill="#2563eb" radius={[0, 3, 3, 0]} name="Spend" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Invoice Aging" description="Open invoice balance by aging bucket.">
          {agingChartData.length === 0 ? (
            <Empty text="No outstanding invoices." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={agingChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(value) => String(value)} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="Invoices" radius={[3, 3, 0, 0]}>
                    {agingChartData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-4 space-y-3">
                {aging.map((row) => {
                  const totalAging = aging.reduce((sum, current) => sum + Number(current.total), 0) || 1;
                  const pct = (Number(row.total) / totalAging) * 100;
                  const color = AGING_COLORS[row.bucket] ?? '#94a3b8';
                  return (
                    <div key={row.bucket}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">{row.bucket}</span>
                        <span className="text-muted-foreground">
                          {fmt(row.total)} ({row.count})
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full transition-[width]"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {cycle ? (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">PO Cycle Time</CardTitle>
            <CardDescription>Draft-to-issued turnaround for purchase orders.</CardDescription>
          </CardHeader>
          <CardContent>
            {!cycle.avgDays ? (
              <Empty text="No issued purchase orders yet." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Average" value={`${fmtN(cycle.avgDays)} days`} />
                <Stat label="Fastest" value={`${fmtN(cycle.minDays)} days`} />
                <Stat label="Slowest" value={`${fmtN(cycle.maxDays)} days`} />
                <Stat label="Sample Size" value={`${cycle.poCount} POs`} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Budget Utilization</CardTitle>
          <CardDescription>Current fiscal year budget consumption across departments and projects.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {budgetUtil.length === 0 ? (
            <Empty text="No budgets for the current fiscal year." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Budget</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Allocated</TableHead>
                  <TableHead>Spent</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetUtil.map((budget) => {
                  const pct = Number(budget.utilizationPct ?? 0);
                  const barColor = pct >= 100 ? '#e11d48' : pct >= 80 ? '#f59e0b' : '#22c55e';
                  return (
                    <TableRow key={budget.budgetId}>
                      <TableCell className="font-medium text-foreground">{budget.budgetName}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{budget.budgetType?.replace('_', ' ')}</TableCell>
                      <TableCell className="text-muted-foreground">{budget.departmentName ?? budget.projectName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{fmt(budget.totalAmount)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmt(budget.spentAmount)}</TableCell>
                      <TableCell className={Number(budget.remaining) < 0 ? 'font-semibold text-rose-700' : 'text-muted-foreground'}>
                        {fmt(budget.remaining)}
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-muted">
                            <div className="h-2 rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }} />
                          </div>
                          <span className="min-w-[40px] text-right text-xs font-medium" style={{ color: pct >= 80 ? barColor : 'hsl(var(--muted-foreground))' }}>
                            {budget.utilizationPct != null ? `${budget.utilizationPct}%` : '—'}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Vendor Performance</CardTitle>
          <CardDescription>Exception rates, approval speed, and approved spend quality by vendor.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {vendPerf.length === 0 ? (
            <Empty text="No vendor data yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoices</TableHead>
                  <TableHead>Exceptions</TableHead>
                  <TableHead>Exception Rate</TableHead>
                  <TableHead>Avg Days to Approve</TableHead>
                  <TableHead>Total Approved</TableHead>
                  <TableHead>POs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendPerf.map((vendor) => {
                  const excRate = Number(vendor.exceptionRate ?? 0);
                  const excColor = excRate === 0 ? '#22c55e' : excRate < 20 ? '#f59e0b' : '#e11d48';
                  return (
                    <TableRow key={vendor.vendorId}>
                      <TableCell className="font-medium text-foreground">{vendor.vendorName}</TableCell>
                      <TableCell className="text-muted-foreground">{vendor.invoiceCount}</TableCell>
                      <TableCell className="text-muted-foreground">{vendor.exceptionCount}</TableCell>
                      <TableCell>
                        <span className="font-semibold" style={{ color: excColor }}>
                          {vendor.exceptionRate != null ? `${vendor.exceptionRate}%` : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {vendor.avgDaysToApprove != null ? `${vendor.avgDaysToApprove} days` : '—'}
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground">{fmt(vendor.totalApproved)}</TableCell>
                      <TableCell className="text-muted-foreground">{vendor.poCount}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ChartCard title="Spend by Category" description="Category-level spend concentration from categorized catalog and invoice data.">
          {categories.length === 0 ? (
            <Empty text="No categorized spend data yet. Assign categories to catalog items to unlock this chart." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(categories.length * 36, 160)}>
              <BarChart
                layout="vertical"
                data={categories.map((category: any) => ({ name: category.category, total: Number(category.total) }))}
                margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                barSize={14}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={120} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" fill="#b45309" radius={[0, 3, 3, 0]} name="Spend" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Spend Anomalies</CardTitle>
            <CardDescription>Vendors with a monthly peak more than 2x their average run rate.</CardDescription>
          </CardHeader>
          <CardContent>
            {anomalies.length === 0 ? (
              <Empty text="No anomalies detected. Vendor spend is within normal range." />
            ) : (
              <div className="space-y-3">
                {anomalies.map((anomaly: any) => (
                  <div key={anomaly.vendorId} className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <AlertTriangle className="h-4 w-4 text-amber-700" />
                        {anomaly.vendorName}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        avg {fmt(anomaly.avgMonthlySpend)}/mo
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-amber-800">{anomaly.peakToAvgRatio}x</div>
                      <div className="text-xs text-muted-foreground">peak / avg</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Department Spend</CardTitle>
          <CardDescription>Approved spend and PO volume by department.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {depts.length === 0 ? (
            <Empty text="No department spend yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Total Spend</TableHead>
                  <TableHead>PO Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {depts.map((dept) => (
                  <TableRow key={dept.department}>
                    <TableCell className="font-medium text-foreground">{dept.department}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(dept.total)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-border/80 bg-muted/40 text-muted-foreground">
                        {dept.poCount} POs
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-[24px]">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="rounded-[24px]">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="rounded-full border border-border/70 bg-muted/30 p-2">
            <Icon className="h-4 w-4 text-foreground" />
          </div>
        </div>
        <div className="text-3xl font-semibold tracking-[-0.03em] text-foreground">{value}</div>
        <div className="mt-2 text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-5">
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
