'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Layers3, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';

function fmtCurrency(n: string | number | null | undefined, currency = 'USD') {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function SoftwareLicensesPage() {
  const [licenses, setLicenses] = useState<any[]>([]);
  const [renewals, setRenewals] = useState<any[]>([]);
  const [utilization, setUtilization] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [form, setForm] = useState({
    vendorId: '',
    contractId: '',
    productName: '',
    seatCount: '25',
    seatsUsed: '18',
    pricePerSeat: '42',
    currency: 'USD',
    billingCycle: 'annual',
    renewalDate: '',
    autoRenews: true,
    renewalLeadDays: '30',
    ownerUserId: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  function loadData() {
    setLoading(true);
    Promise.all([
      api.softwareLicenses.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(vendorFilter ? { vendorId: vendorFilter } : {}),
      }),
      api.softwareLicenses.renewalCalendar(90),
      api.softwareLicenses.utilization(),
      api.vendors.list(),
      api.users.list(),
      api.contracts.list(),
    ])
      .then(([licenseRows, renewalRows, utilizationRows, vendorRows, userRows, contractRows]) => {
        setLicenses(licenseRows);
        setRenewals(renewalRows);
        setUtilization(utilizationRows);
        setVendors(vendorRows);
        setUsers(userRows);
        setContracts(contractRows);
        if (!form.vendorId && vendorRows[0]?.id) {
          setForm((current) => ({ ...current, vendorId: vendorRows[0].id }));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, vendorFilter]);

  const totalAnnualized = useMemo(
    () =>
      utilization.reduce((sum, row) => {
        const contractValue = Number(row.contractValue ?? 0);
        return sum + (row.billingCycle === 'monthly' ? contractValue * 12 : contractValue);
      }, 0),
    [utilization],
  );

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.softwareLicenses.create({
        vendorId: form.vendorId,
        contractId: form.contractId || undefined,
        productName: form.productName,
        seatCount: parseInt(form.seatCount, 10),
        seatsUsed: parseInt(form.seatsUsed, 10),
        pricePerSeat: form.pricePerSeat,
        currency: form.currency,
        billingCycle: form.billingCycle,
        renewalDate: form.renewalDate ? new Date(form.renewalDate).toISOString() : undefined,
        autoRenews: form.autoRenews,
        renewalLeadDays: parseInt(form.renewalLeadDays, 10),
        ownerUserId: form.ownerUserId || undefined,
        notes: form.notes || undefined,
      });
      setForm((current) => ({
        ...current,
        productName: '',
        notes: '',
      }));
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="Software Licenses"
        description="Track seat utilization, annualized spend, and renewal exposure for SaaS contracts."
        actions={
          <>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-w-[170px]">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="renewal_due">Renewal Due</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </Select>
            <Select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} className="min-w-[180px]">
              <option value="">All vendors</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active Licenses</div>
            <div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{licenses.length}</div>
            <div className="text-sm text-muted-foreground">{renewals.length} renewal events in the next 90 days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Annualized Spend</div>
            <div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{fmtCurrency(totalAnnualized)}</div>
            <div className="text-sm text-muted-foreground">Based on current seat counts and billing cycles</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Underutilized Licenses</div>
            <div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
              {utilization.filter((row) => Number(row.utilizationPct ?? 0) < 70).length}
            </div>
            <div className="text-sm text-muted-foreground">Using less than 70% of purchased seats</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">License Inventory</CardTitle>
            <CardDescription>Current products, renewal timing, and active value by vendor.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
                Loading licenses...
              </div>
            ) : licenses.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="rounded-full bg-muted p-4">
                  <Layers3 className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">No software licenses tracked yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Add your first SaaS license to start renewal and utilization monitoring.</p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Product</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Renewal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {licenses.map((license) => (
                    <TableRow key={license.id}>
                      <TableCell className="font-semibold">
                        <Link href={`/software-licenses/${license.id}`} className="text-primary hover:underline">
                          {license.productName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{license.vendor?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {license.seatsUsed}/{license.seatCount}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(license.renewalDate)}</TableCell>
                      <TableCell>
                        <StatusBadge value={license.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {fmtCurrency(Number(license.seatCount) * Number(license.pricePerSeat), license.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add License</CardTitle>
            <CardDescription>Create a new tracked SaaS contract and renewal profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitForm} className="grid gap-3">
              <Input
                value={form.productName}
                onChange={(event) => setForm({ ...form, productName: event.target.value })}
                placeholder="Product name"
                required
              />
              <Select value={form.vendorId} onChange={(event) => setForm({ ...form, vendorId: event.target.value })} required className="w-full">
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
              <Select value={form.contractId} onChange={(event) => setForm({ ...form, contractId: event.target.value })} className="w-full">
                <option value="">No linked contract</option>
                {contracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    {contract.contractNumber} · {contract.title}
                  </option>
                ))}
              </Select>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input type="number" min="1" value={form.seatCount} onChange={(event) => setForm({ ...form, seatCount: event.target.value })} placeholder="Seats purchased" required />
                <Input type="number" min="0" value={form.seatsUsed} onChange={(event) => setForm({ ...form, seatsUsed: event.target.value })} placeholder="Seats used" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input value={form.pricePerSeat} onChange={(event) => setForm({ ...form, pricePerSeat: event.target.value })} placeholder="Price / seat" required />
                <Select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className="w-full">
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </Select>
                <Select value={form.billingCycle} onChange={(event) => setForm({ ...form, billingCycle: event.target.value })} className="w-full">
                  <option value="annual">Annual</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input type="date" value={form.renewalDate} onChange={(event) => setForm({ ...form, renewalDate: event.target.value })} />
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={form.renewalLeadDays}
                  onChange={(event) => setForm({ ...form, renewalLeadDays: event.target.value })}
                  placeholder="Lead days"
                />
              </div>
              <Select value={form.ownerUserId} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value })} className="w-full">
                <option value="">No owner assigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name ?? user.email}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input type="checkbox" checked={form.autoRenews} onChange={(event) => setForm({ ...form, autoRenews: event.target.checked })} />
                Auto-renews
              </label>
              <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notes" rows={4} />
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                {saving ? 'Saving...' : 'Add Software License'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Renewal Calendar</CardTitle>
            <CardDescription>Upcoming renewal deadlines in the next 90 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {renewals.slice(0, 8).map((renewal) => (
              <div key={renewal.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <div>
                  <Link href={`/software-licenses/${renewal.id}`} className="font-medium text-primary hover:underline">
                    {renewal.productName}
                  </Link>
                  <div className="text-sm text-muted-foreground">{renewal.vendor?.name ?? '—'}</div>
                </div>
                <div className="text-sm text-muted-foreground">{fmtDate(renewal.renewalDate)}</div>
              </div>
            ))}
            {renewals.length === 0 ? <div className="text-sm text-muted-foreground">No renewals due in the next 90 days.</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Utilization Watchlist</CardTitle>
            <CardDescription>Seats that are materially underused relative to the contract.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {utilization.slice(0, 8).map((row) => (
              <div key={row.id} className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <Link href={`/software-licenses/${row.id}`} className="font-medium text-primary hover:underline">
                    {row.productName}
                  </Link>
                  <div className="text-sm text-muted-foreground">{Number(row.utilizationPct ?? 0).toFixed(1)}%</div>
                </div>
                <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${Number(row.utilizationPct ?? 0) < 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(Number(row.utilizationPct ?? 0), 100)}%` }}
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  {row.seatsUsed}/{row.seatCount} seats used · {fmtCurrency(row.contractValue, row.currency)}
                </div>
              </div>
            ))}
            {utilization.length === 0 ? <div className="text-sm text-muted-foreground">No utilization data yet.</div> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
