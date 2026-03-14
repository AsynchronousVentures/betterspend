'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardCheck, PackageCheck } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';

interface PO {
  id: string;
  number: string;
  status: string;
  vendor: { name: string } | null;
  lines: Array<{
    id: string;
    lineNumber: string;
    description: string;
    quantity: string;
    quantityReceived: string;
  }>;
}

function NewGRNForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preSelectedPoId = searchParams.get('poId') ?? '';

  const [pos, setPOs] = useState<PO[]>([]);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lineQtys, setLineQtys] = useState<Record<string, { received: string; rejected: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.purchaseOrders
      .list()
      .then((data) => {
        const eligible = (Array.isArray(data) ? data : (data as any).data ?? []).filter((po: PO) =>
          ['approved', 'issued', 'partially_received'].includes(po.status),
        );
        setPOs(eligible);
        if (preSelectedPoId) {
          void handlePOChange(preSelectedPoId);
        }
      })
      .catch(() => {});
  }, [preSelectedPoId]);

  async function handlePOChange(poId: string) {
    if (!poId) {
      setSelectedPO(null);
      setLineQtys({});
      return;
    }
    const po = (await api.purchaseOrders.get(poId)) as PO;
    setSelectedPO(po);
    const qtys: Record<string, { received: string; rejected: string }> = {};
    (po.lines ?? []).forEach((line) => {
      qtys[line.id] = { received: line.quantity, rejected: '0' };
    });
    setLineQtys(qtys);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPO) return;
    setLoading(true);
    setError('');

    const lines = (selectedPO.lines ?? [])
      .filter((line) => parseFloat(lineQtys[line.id]?.received ?? '0') > 0)
      .map((line) => ({
        poLineId: line.id,
        quantityReceived: parseFloat(lineQtys[line.id]?.received ?? '0'),
        quantityRejected: parseFloat(lineQtys[line.id]?.rejected ?? '0'),
      }));

    try {
      const grn = await api.receiving.create({
        purchaseOrderId: selectedPO.id,
        receivedDate,
        notes: notes || undefined,
        lines,
      });
      router.push(`/receiving/${(grn as any).id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create GRN');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Create Goods Receipt"
        description="Capture received and rejected quantities against an approved or issued purchase order."
        actions={
          <Button asChild variant="outline">
            <Link href="/receiving">Cancel</Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Receipt Details</CardTitle>
            <CardDescription>
              Select the purchase order being received and capture any receiving notes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Purchase Order">
              <Select
                value={selectedPO?.id ?? ''}
                onChange={(event) => void handlePOChange(event.target.value)}
                required
                className="w-full"
              >
                <option value="">Select a PO...</option>
                {pos.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.number} - {po.vendor?.name ?? 'Unknown vendor'}
                  </option>
                ))}
              </Select>
              {pos.length === 0 ? (
                <div className="mt-2 text-sm text-muted-foreground">
                  No eligible POs. Purchase orders must be approved, issued, or partially received.
                </div>
              ) : null}
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Received Date">
                <Input
                  type="date"
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                  required
                />
              </Field>

              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                Only lines with a positive received quantity will be added to the GRN.
              </div>
            </div>

            <Field label="Notes">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </Field>
          </CardContent>
        </Card>

        {selectedPO && (selectedPO.lines ?? []).length > 0 ? (
          <Card className="rounded-[24px]">
            <CardHeader>
              <CardTitle className="text-xl">Line Items</CardTitle>
              <CardDescription>
                Confirm received quantities and capture rejected quantities separately.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>PO Qty</TableHead>
                    <TableHead>Received Qty</TableHead>
                    <TableHead>Rejected Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(selectedPO.lines ?? []).map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-muted-foreground">{line.lineNumber}</TableCell>
                      <TableCell className="font-medium text-foreground">{line.description}</TableCell>
                      <TableCell className="text-muted-foreground">{line.quantity}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          max={line.quantity}
                          value={lineQtys[line.id]?.received ?? ''}
                          onChange={(event) =>
                            setLineQtys((prev) => ({
                              ...prev,
                              [line.id]: { ...prev[line.id], received: event.target.value },
                            }))
                          }
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={lineQtys[line.id]?.rejected ?? '0'}
                          onChange={(event) =>
                            setLineQtys((prev) => ({
                              ...prev,
                              [line.id]: { ...prev[line.id], rejected: event.target.value },
                            }))
                          }
                          className="w-28"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={loading || !selectedPO}>
            <PackageCheck className="h-4 w-4" />
            {loading ? 'Creating...' : 'Create GRN'}
          </Button>
          <Button asChild variant="outline">
            <Link href="/receiving">
              <ClipboardCheck className="h-4 w-4" />
              Back to Receiving
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewGRNPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 lg:p-8">
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        </div>
      }
    >
      <NewGRNForm />
    </Suspense>
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
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
