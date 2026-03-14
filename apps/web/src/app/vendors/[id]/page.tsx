'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Globe, Mail, Pencil, PlugZap, ShieldCheck } from 'lucide-react';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import Breadcrumbs from '../../../components/breadcrumbs';
import { StatusBadge } from '../../../components/status-badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>({});
  const [txns, setTxns] = useState<{ invoices: any[]; purchaseOrders: any[] } | null>(null);
  const [onboarding, setOnboarding] = useState<any>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [punchoutSaving, setPunchoutSaving] = useState(false);
  const [portalSending, setPortalSending] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');

  useEffect(() => {
    api.vendors
      .get(id)
      .then((vendorRecord) => {
        setVendor(vendorRecord);
        setForm({
          name: vendorRecord.name || '',
          code: vendorRecord.code || '',
          taxId: vendorRecord.taxId || '',
          paymentTerms: vendorRecord.paymentTerms || '',
          status: vendorRecord.status || 'active',
          contactName: vendorRecord.contactInfo?.contactName || '',
          email: vendorRecord.contactInfo?.email || '',
          phone: vendorRecord.contactInfo?.phone || '',
          street: vendorRecord.address?.street || '',
          city: vendorRecord.address?.city || '',
          state: vendorRecord.address?.state || '',
          postalCode: vendorRecord.address?.postalCode || '',
          country: vendorRecord.address?.country || '',
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    api.vendors.transactions(id).then(setTxns).catch(() => {});
    api.vendors.onboardingDetail(id).then(setOnboarding).catch(() => {});
  }, [id]);

  function set(key: string, value: string) {
    setForm((current: any) => ({ ...current, [key]: value }));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.vendors.update(id, {
        name: form.name,
        code: form.code || undefined,
        taxId: form.taxId || undefined,
        paymentTerms: form.paymentTerms || undefined,
        status: form.status,
        contactInfo: {
          contactName: form.contactName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
        },
        address: {
          street: form.street || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          postalCode: form.postalCode || undefined,
          country: form.country || undefined,
        },
      });
      setVendor(updated);
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendPortalAccess() {
    setPortalSending(true);
    setPortalMsg('');
    try {
      await api.vendorPortal.sendAccess(id);
      setPortalMsg("Access link sent to vendor's contact email.");
    } catch (err: any) {
      setPortalMsg(`Error: ${err.message || 'Failed to send access link'}`);
    } finally {
      setPortalSending(false);
    }
  }

  async function reviewOnboarding(decision: 'approved' | 'changes_requested') {
    setReviewSaving(true);
    try {
      const updated = await api.vendors.reviewOnboarding(id, { decision });
      setVendor((current: any) => ({ ...current, ...updated }));
      setOnboarding(await api.vendors.onboardingDetail(id));
      toast(decision === 'approved' ? 'Onboarding approved' : 'Changes requested', 'success');
    } catch (err: any) {
      setPortalMsg(`Error: ${err.message || 'Failed to review onboarding'}`);
    } finally {
      setReviewSaving(false);
    }
  }

  async function togglePunchout() {
    setPunchoutSaving(true);
    try {
      const updated = await api.vendors.update(id, { punchoutEnabled: !vendor.punchoutEnabled });
      setVendor(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPunchoutSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  if (error && !vendor) return <div className="p-8 text-sm text-rose-700">{error}</div>;
  if (!vendor) return null;

  const latestSubmission = onboarding?.submissions?.[0] ?? null;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Vendors', href: '/vendors' }, { label: vendor.name }]} />
      <Link href="/vendors" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Vendors
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-sm font-semibold">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{vendor.name}</h1>
            <StatusBadge value={vendor.status || 'inactive'} />
          </div>
          <div className="text-sm text-muted-foreground">
            {vendor.code ? `${vendor.code} · ` : ''}{vendor.paymentTerms || 'No payment terms set'}
          </div>
        </div>
        {!editing ? (
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={handleSendPortalAccess} disabled={portalSending}>
              <Mail className="h-4 w-4" />
              {portalSending ? 'Sending...' : 'Send Portal Access Link'}
            </Button>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        ) : null}
      </div>

      {!editing ? (
        <div className="space-y-6">
          <Section title="Basic Info">
            <Field label="Code" value={vendor.code || '—'} />
            <Field label="Tax ID" value={vendor.taxId || '—'} />
            <Field label="Payment Terms" value={vendor.paymentTerms || '—'} />
            <Field label="Status" value={vendor.status || '—'} />
          </Section>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Onboarding</CardTitle>
              <StatusBadge value={vendor.onboardingStatus || 'not_started'} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Risk Score" value={String(vendor.onboardingRiskScore ?? 0)} />
                <Field label="Risk Level" value={String(vendor.onboardingRiskLevel ?? 'low')} />
                <Field label="Submitted" value={vendor.onboardingLastSubmittedAt ? new Date(vendor.onboardingLastSubmittedAt).toLocaleString() : '—'} />
              </div>

              {latestSubmission ? (
                <div className="rounded-lg border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
                  <div>Latest questionnaire: {latestSubmission.questionnaire?.name ?? 'Default questionnaire'}</div>
                  <div className="mt-2">
                    Documents: W-9 {latestSubmission.documentLinks?.w9 ? 'attached' : 'missing'} · COI {latestSubmission.documentLinks?.coi ? 'attached' : 'missing'} · Banking {latestSubmission.documentLinks?.banking ? 'attached' : 'missing'}
                  </div>
                  {latestSubmission.reviewNote ? <div className="mt-2">Review note: {latestSubmission.reviewNote}</div> : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link href="/vendors/onboarding">Open Onboarding Queue</Link>
                </Button>
                {vendor.onboardingStatus === 'pending_review' ? (
                  <>
                    <Button onClick={() => reviewOnboarding('approved')} disabled={reviewSaving}>
                      <ShieldCheck className="h-4 w-4" />
                      Approve Onboarding
                    </Button>
                    <Button variant="outline" onClick={() => reviewOnboarding('changes_requested')} disabled={reviewSaving}>
                      Request Changes
                    </Button>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Section title="Contact">
            <Field label="Contact Name" value={vendor.contactInfo?.contactName || '—'} />
            <Field label="Email" value={vendor.contactInfo?.email || '—'} />
            <Field label="Phone" value={vendor.contactInfo?.phone || '—'} />
          </Section>

          <Section title="Address">
            <Field label="Street" value={vendor.address?.street || '—'} />
            <Field label="City" value={vendor.address?.city || '—'} />
            <Field label="State" value={vendor.address?.state || '—'} />
            <Field label="Postal Code" value={vendor.address?.postalCode || '—'} />
            <Field label="Country" value={vendor.address?.country || '—'} />
          </Section>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">
                Purchase Orders {txns ? `(${txns.purchaseOrders.length})` : ''}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!txns || txns.purchaseOrders.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No purchase orders.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>PO Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Issued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.purchaseOrders.map((po: any) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-medium">
                          <Link href={`/purchase-orders/${po.id}`} className="text-primary hover:underline">
                            {po.number}
                          </Link>
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">{po.status}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {po.amount != null
                            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(po.amount)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {po.issuedAt ? new Date(po.issuedAt).toLocaleDateString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Invoices {txns ? `(${txns.invoices.length})` : ''}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!txns || txns.invoices.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No invoices.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Vendor #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.invoices.map((invoice: any) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">
                          <Link href={`/invoices/${invoice.id}`} className="text-primary hover:underline">
                            {invoice.number}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{invoice.vendorInvoiceNumber ?? '—'}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">{invoice.status}</TableCell>
                        <TableCell className={invoice.matchStatus === 'exception' ? 'text-rose-700' : 'text-muted-foreground'}>
                          {invoice.matchStatus ?? '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {invoice.amount != null
                            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(invoice.amount)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {invoice.date ? new Date(invoice.date).toLocaleDateString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4" />
                Vendor Portal
              </CardTitle>
              <Button variant="outline" onClick={handleSendPortalAccess} disabled={portalSending}>
                {portalSending ? 'Sending...' : 'Send Access Link'}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Send a secure, tokenized portal link so the vendor can view purchase orders and submit invoices directly.
              </p>
              {portalMsg ? (
                <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${portalMsg.startsWith('Error') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {portalMsg}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <PlugZap className="h-4 w-4" />
                Punchout (cXML)
              </CardTitle>
              <Button variant="outline" onClick={togglePunchout} disabled={punchoutSaving}>
                {punchoutSaving ? 'Saving...' : vendor.punchoutEnabled ? 'Disable' : 'Enable'}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Allow this vendor&apos;s catalog to be browsed via cXML PunchOut.{' '}
                {vendor.punchoutEnabled ? (
                  <span className="font-semibold text-emerald-700">Enabled</span>
                ) : (
                  <span className="text-muted-foreground">Disabled</span>
                )}
              </p>
              {vendor.punchoutEnabled ? (
                <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                  Setup endpoint: <code className="font-mono">POST /api/v1/punchout/vendors/{vendor.id}/setup</code>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic Info</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-foreground">Name *</label>
                <Input required value={form.name} onChange={(event) => set('name', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Code</label>
                <Input value={form.code} onChange={(event) => set('code', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Tax ID</label>
                <Input value={form.taxId} onChange={(event) => set('taxId', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Payment Terms</label>
                <Select value={form.paymentTerms} onChange={(event) => set('paymentTerms', event.target.value)} className="w-full">
                  {['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', '2/10 Net 30'].map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Status</label>
                <Select value={form.status} onChange={(event) => set('status', event.target.value)} className="w-full">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="blocked">Blocked</option>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Contact Name</label>
                <Input value={form.contactName} onChange={(event) => set('contactName', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Email</label>
                <Input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Phone</label>
                <Input value={form.phone} onChange={(event) => set('phone', event.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-foreground">Street</label>
                <Input value={form.street} onChange={(event) => set('street', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">City</label>
                <Input value={form.city} onChange={(event) => set('city', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">State</label>
                <Input value={form.state} onChange={(event) => set('state', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Postal Code</label>
                <Input value={form.postalCode} onChange={(event) => set('postalCode', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Country</label>
                <Input value={form.country} onChange={(event) => set('country', event.target.value)} />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
