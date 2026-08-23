'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';

interface VendorScreeningStatus {
  id: string;
  name: string;
  status: string;
  sanctionsStatus: 'untested' | 'clear' | 'flagged' | 'manually_reviewed';
  sanctionsCheckedAt: string | null;
  sanctionsNote: string | null;
}

function toneFor(status: VendorScreeningStatus['sanctionsStatus']) {
  if (status === 'clear') return 'success';
  if (status === 'flagged') return 'destructive';
  if (status === 'manually_reviewed') return 'warning';
  return 'secondary';
}

export default function RiskScreeningPage() {
  const [vendors, setVendors] = useState<VendorScreeningStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyVendorId, setBusyVendorId] = useState<string | null>(null);
  const [screenAllBusy, setScreenAllBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [reviewVendor, setReviewVendor] = useState<VendorScreeningStatus | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      setVendors(await api.riskScreening.list());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load screening status');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runScreenAll() {
    setScreenAllBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.riskScreening.screenAll();
      setMessage(`Screened ${result.screened} vendors; ${result.flagged} flagged.`);
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Bulk screening failed');
    } finally {
      setScreenAllBusy(false);
    }
  }

  async function runIngest() {
    setIngestBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.riskScreening.ingest();
      setMessage(`Imported ${result.count} ${result.source} entries.`);
    } catch (runError) {
      setError(
        runError instanceof Error && runError.message.includes('403')
          ? 'Importing sanctions lists requires an admin.'
          : runError instanceof Error
            ? runError.message
            : 'Sanctions list import failed',
      );
    } finally {
      setIngestBusy(false);
    }
  }

  async function rescreen(vendor: VendorScreeningStatus) {
    setBusyVendorId(vendor.id);
    setError('');
    setMessage('');
    try {
      const result = await api.riskScreening.screenVendor(vendor.id);
      setMessage(
        result.status === 'flagged'
          ? `${vendor.name}: flagged with ${result.matches.length} potential match(es).`
          : `${vendor.name}: clear.`,
      );
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Screening failed');
    } finally {
      setBusyVendorId(null);
    }
  }

  async function submitManualReview() {
    if (!reviewVendor || !reviewNote.trim()) return;
    setBusyVendorId(reviewVendor.id);
    setError('');
    try {
      await api.riskScreening.manualReview(reviewVendor.id, reviewNote.trim());
      setMessage(`${reviewVendor.name} marked as manually reviewed.`);
      setReviewVendor(null);
      setReviewNote('');
      await load();
    } catch (runError) {
      setError(
        runError instanceof Error && runError.message.includes('403')
          ? 'Manual review decisions require an admin.'
          : runError instanceof Error
            ? runError.message
            : 'Manual review failed',
      );
    } finally {
      setBusyVendorId(null);
    }
  }

  const flaggedCount = vendors.filter((v) => v.sanctionsStatus === 'flagged').length;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Risk Screening"
        description="Screen suppliers against public sanctions lists before they receive purchase orders."
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={runIngest} disabled={ingestBusy}>
              <ShieldCheck className="h-4 w-4" />
              {ingestBusy ? 'Importing...' : 'Import Sanctions List'}
            </Button>
            <Button type="button" onClick={runScreenAll} disabled={screenAllBusy}>
              {screenAllBusy ? 'Screening...' : 'Re-screen All Vendors'}
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-lg">
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Flagged vendors</div>
            <div className="mt-2 text-3xl font-semibold text-foreground">{flaggedCount}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Untested vendors</div>
            <div className="mt-2 text-3xl font-semibold text-foreground">
              {vendors.filter((v) => v.sanctionsStatus === 'untested').length}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-5 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">PO policy</div>
            <p className="text-sm text-muted-foreground">
              Flagged vendors are blocked from new POs when
              {' '}
              <span className="font-mono text-xs">block_pos_for_flagged_vendors</span>
              {' '}
              is enabled in settings; otherwise POs warn only.
            </p>
          </CardContent>
        </Card>
      </div>

      {reviewVendor ? (
        <Card className="rounded-lg border-amber-300/70 bg-amber-50/40">
          <CardHeader>
            <CardTitle className="text-xl">Manual review: {reviewVendor.name}</CardTitle>
            <CardDescription>
              Record why this vendor is cleared despite screening results. The decision is audit logged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              rows={3}
              placeholder="Required justification for clearing this vendor"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setReviewVendor(null); setReviewNote(''); }}>
                Cancel
              </Button>
              <Button type="button" onClick={submitManualReview} disabled={!reviewNote.trim()}>
                Save Decision
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Vendor Screening Status</CardTitle>
          <CardDescription>Current sanctions status per vendor across the organization.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">Loading...</div>
          ) : vendors.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">No vendors found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium text-foreground">{vendor.name}</TableCell>
                    <TableCell>
                      <Badge variant={toneFor(vendor.sanctionsStatus)}>
                        {vendor.sanctionsStatus.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {vendor.sanctionsCheckedAt
                        ? new Date(vendor.sanctionsCheckedAt).toLocaleDateString()
                        : 'Never'}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {vendor.sanctionsNote ?? ''}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => rescreen(vendor)}
                          disabled={busyVendorId === vendor.id}
                        >
                          {busyVendorId === vendor.id ? '...' : 'Re-screen'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setReviewVendor(vendor)}
                          disabled={busyVendorId === vendor.id}
                        >
                          Manual Review
                        </Button>
                      </div>
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
