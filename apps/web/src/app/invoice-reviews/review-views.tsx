'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { InvoiceReviewCommandInput } from '@betterspend/shared';
import type { InvoiceReviewListQuery, InvoiceReviewListResult } from '../../lib/api-contracts';
import type { InvoiceReviewProjection } from '../../lib/api-contracts';
import { invoiceReviewListPath } from '../../lib/api';
import { formatDateOnly } from '../../lib/date-only';
import { ListState } from '../../components/resource-state';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

export interface NamedOption {
  id: string;
  name: string;
}

function formatCurrency(amount: string, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export function namedOptions(value: unknown): NamedOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const id = 'id' in item ? item.id : undefined;
    const name = 'name' in item ? item.name : undefined;
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : [];
  });
}

function selectedName(options: NamedOption[], id: string | null) {
  if (!id) return 'Unassigned';
  return options.find((option) => option.id === id)?.name ?? id;
}

export function InvoiceReviewQueue({
  result,
  query,
  owners,
  vendors,
  entities,
}: {
  result: InvoiceReviewListResult;
  query: InvoiceReviewListQuery;
  owners: NamedOption[];
  vendors: NamedOption[];
  entities: NamedOption[];
}) {
  return (
    <div className="space-y-4">
      <Card>
        <form
          key={invoiceReviewListPath({ ...query, cursor: undefined })}
          action="/invoice-reviews"
        >
          <CardContent className="grid gap-4 p-5 md:grid-cols-4 xl:grid-cols-8">
            <FilterSelect name="state" label="Case state" value={query.state}>
              <option value="">All states</option>
              <option value="open">Open</option>
              <option value="in_review">In review</option>
              <option value="waiting_on_supplier">Waiting on supplier</option>
              <option value="resolved">Resolved</option>
            </FilterSelect>
            <FilterSelect name="signalType" label="Signal type" value={query.signalType}>
              <option value="">All signals</option>
              <option value="low_extraction_confidence">Low extraction confidence</option>
              <option value="duplicate_risk">Duplicate risk</option>
              <option value="sender_risk">Sender risk</option>
              <option value="match_exception">Match exception</option>
              <option value="bank_detail_change_risk">Bank detail change</option>
              <option value="manual_review">Manual review</option>
            </FilterSelect>
            <FilterSelect name="severity" label="Severity" value={query.severity}>
              <option value="">All severities</option>
              <option value="blocking">Blocking</option>
              <option value="review_required">Review required</option>
              <option value="informational">Informational</option>
            </FilterSelect>
            <FilterLookup name="ownerId" label="Owner" value={query.ownerId} options={owners} />
            <FilterLookup name="vendorId" label="Vendor" value={query.vendorId} options={vendors} />
            <FilterLookup
              name="entityId"
              label="Entity"
              value={query.entityId}
              options={entities}
            />
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Minimum age
              </span>
              <Input
                name="minAgeDays"
                type="number"
                min={0}
                max={3650}
                defaultValue={query.minAgeDays}
                placeholder="Days"
              />
            </label>
            <FilterSelect name="sort" label="Sort" value={query.sort ?? 'oldest_signal'}>
              <option value="oldest_signal">Oldest signal</option>
              <option value="due_date">Due date</option>
            </FilterSelect>
            <div className="flex gap-2 md:col-span-4 xl:col-span-8">
              <Button type="submit">Apply filters</Button>
              <Button asChild type="button" variant="outline">
                <Link href="/invoice-reviews">Clear</Link>
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <Card className="rounded-[28px] border-dashed border-border/80 bg-card/80">
          <ListState
            state="empty"
            loadingLabel="Loading AP exception queue..."
            emptyTitle="No matching review cases"
            emptyDescription="Clear or change the filters to see other AP exceptions."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-[28px] border-border/70 bg-card/95">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Signals</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item) => (
                  <TableRow key={item.case.id}>
                    <TableCell>
                      <Link
                        className="font-semibold text-primary hover:underline"
                        href={`/invoice-reviews/${item.invoice.id}`}
                      >
                        {item.invoice.invoiceNumber}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {item.invoice.internalNumber}
                      </div>
                    </TableCell>
                    <TableCell>{item.invoice.vendor?.name ?? 'Restricted vendor'}</TableCell>
                    <TableCell>{item.invoice.entity?.name ?? 'No entity'}</TableCell>
                    <TableCell>
                      {formatCurrency(item.invoice.totalAmount, item.invoice.currency)}
                    </TableCell>
                    <TableCell>{formatDateOnly(item.invoice.dueDate)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          item.case.blockingSignalCount > 0
                            ? 'font-semibold text-destructive'
                            : undefined
                        }
                      >
                        {item.case.blockingSignalCount} blocking
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {item.case.unresolvedSignalCount} unresolved
                      </div>
                    </TableCell>
                    <TableCell>{selectedName(owners, item.case.ownerId)}</TableCell>
                    <TableCell>{item.case.ageDays} days</TableCell>
                    <TableCell>
                      <CaseStateBadge value={item.case.state} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {result.nextCursor ? (
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <Link href={invoiceReviewListPath({ ...query, cursor: result.nextCursor })}>
              Next page
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <Select name={name} defaultValue={value}>
        {children}
      </Select>
    </label>
  );
}

function FilterLookup({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: NamedOption[];
}) {
  const listId = `invoice-review-${name}-options`;
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <Input name={name} list={listId} defaultValue={value} placeholder={`${label} ID`} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </datalist>
    </label>
  );
}

export function InvoiceReviewDetail({
  projection,
  assignees,
  onCommand,
  messageThread,
}: {
  projection: InvoiceReviewProjection;
  assignees: NamedOption[];
  onCommand: (command: InvoiceReviewCommandInput) => Promise<void>;
  messageThread?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [assigneeId, setAssigneeId] = useState(assignees[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const terminal = ['paid', 'cancelled'].includes(projection.invoice.status);
  // A resolved case rejects every case command with INVALID_TRANSITION, so only the
  // per-signal actions stay available for it.
  const caseCommandsAvailable = !terminal && projection.case.state !== 'resolved';
  const blockers = projection.signals.filter(
    (signal) => signal.status === 'open' && signal.severity === 'blocking',
  );
  const missingSources = [
    ...projection.signals.filter((signal) => signal.source.availability === 'missing'),
    ...projection.provenance.fields.filter((field) => field.source.availability === 'missing'),
  ];

  async function submit(command: InvoiceReviewCommandInput) {
    if (busy || terminal) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await onCommand(command);
      setSuccess('Review case updated.');
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : 'Review command failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {terminal ? (
        <Alert role="status">
          <AlertDescription>
            This invoice is read-only because it is {projection.invoice.status}.
          </AlertDescription>
        </Alert>
      ) : blockers.length > 0 || missingSources.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            Invoice workflow remains blocked. Resolve or waive {blockers.length} blocking signal
            {blockers.length === 1 ? '' : 's'} and investigate {missingSources.length} missing
            source
            {missingSources.length === 1 ? '' : 's'} before approval or payment release.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert role="status" variant="success">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-labelledby="review-summary"
        className="space-y-4 border-y border-border/70 py-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="review-summary" className="text-lg font-semibold">
              Invoice summary
            </h2>
            <p className="text-sm text-muted-foreground">
              {projection.invoice.internalNumber} · {projection.invoice.invoiceNumber}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/invoices/${projection.invoice.id}`}>Open invoice</Link>
            </Button>
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Vendor" value={projection.invoice.vendor?.name ?? 'Restricted vendor'} />
          <Fact label="Entity" value={projection.invoice.entity?.name ?? 'No entity'} />
          <Fact
            label="Amount"
            value={formatCurrency(projection.invoice.totalAmount, projection.invoice.currency)}
          />
          <Fact
            label="Subtotal"
            value={formatCurrency(projection.invoice.subtotal, projection.invoice.currency)}
          />
          <Fact
            label="Tax"
            value={formatCurrency(projection.invoice.taxAmount, projection.invoice.currency)}
          />
          <Fact label="Invoice date" value={formatDateOnly(projection.invoice.invoiceDate)} />
          <Fact label="Due date" value={formatDateOnly(projection.invoice.dueDate)} />
          <Fact
            label="Purchase order"
            value={projection.invoice.purchaseOrder?.number ?? 'No purchase order'}
          />
          <Fact label="Invoice status" value={<StatusBadge value={projection.invoice.status} />} />
          <Fact label="Case state" value={<CaseStateBadge value={projection.case.state} />} />
          <Fact label="Owner" value={projection.case.owner?.name ?? 'Unassigned'} />
          <Fact label="Opened" value={new Date(projection.case.openedAt).toLocaleString()} />
          <Fact label="Version" value={String(projection.case.version)} />
        </dl>

        {caseCommandsAvailable ? (
          <div aria-label="Case commands" className="space-y-3 border-t border-border/70 pt-4">
            <div className="flex flex-wrap gap-2">
              {!projection.case.ownerId ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void submit({ action: 'claim', expectedVersion: projection.case.version })
                  }
                >
                  Claim
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void submit({ action: 'release', expectedVersion: projection.case.version })
                  }
                >
                  Release
                </Button>
              )}
              {projection.case.state === 'waiting_on_supplier' ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void submit({
                      action: 'mark_info_received',
                      expectedVersion: projection.case.version,
                      ...(reason.trim() ? { overrideReason: reason.trim() } : {}),
                    })
                  }
                >
                  Mark info received
                </Button>
              ) : null}
            </div>
            <Card>
              <CardContent className="grid gap-4 p-5">
                <div className="grid gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_auto]">
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Reassign owner
                    </span>
                    <Input
                      list="invoice-review-assignees"
                      value={assigneeId}
                      onChange={(event) => setAssigneeId(event.target.value)}
                      placeholder="Reviewer ID"
                    />
                  </label>
                  <datalist id="invoice-review-assignees">
                    {assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.name}
                      </option>
                    ))}
                  </datalist>
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Reason
                    </span>
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Reason for reassignment, waiver, or owner override"
                    />
                  </label>
                  <Button
                    className="md:self-end"
                    variant="outline"
                    disabled={busy || !assigneeId || !reason.trim()}
                    onClick={() =>
                      void submit({
                        action: 'reassign',
                        expectedVersion: projection.case.version,
                        assigneeId,
                        reason,
                      })
                    }
                  >
                    Reassign
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Supplier information request
                    </span>
                    <Textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Information needed from the supplier"
                    />
                  </label>
                  <Button
                    className="md:self-end"
                    variant="outline"
                    disabled={busy || !message.trim()}
                    onClick={() =>
                      void submit({
                        action: 'request_supplier_info',
                        expectedVersion: projection.case.version,
                        message,
                        ...(reason.trim() ? { overrideReason: reason.trim() } : {}),
                      })
                    }
                  >
                    Request info
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </section>

      <ReviewSection id="review-documents" title="Original documents">
        {projection.invoice.documentId ? (
          <p className="text-xs text-muted-foreground">
            Original document reference:{' '}
            <span className="font-mono text-foreground">{projection.invoice.documentId}</span>
          </p>
        ) : null}
        {projection.documents.length === 0 ? (
          <EmptyValue>Original document reference is unavailable.</EmptyValue>
        ) : (
          projection.documents.map((document) => (
            <div
              key={document.id}
              className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-2 text-sm last:border-0"
            >
              <span className="font-medium">{document.filename}</span>
              <span className="text-muted-foreground">
                {document.id === projection.invoice.documentId
                  ? 'Original document'
                  : 'Supporting document'}{' '}
                · {document.contentType} · {formatBytes(document.sizeBytes)}
              </span>
            </div>
          ))
        )}
      </ReviewSection>

      <ReviewSection id="review-signals" title="Review signals">
        {projection.signals.length === 0 ? (
          <EmptyValue>No review signals.</EmptyValue>
        ) : (
          projection.signals.map((signal) => (
            <article
              key={signal.id}
              className={`space-y-3 border-l-2 py-3 pl-4 ${signal.severity === 'blocking' && signal.status === 'open' ? 'border-destructive' : 'border-border'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{signal.summary}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{humanize(signal.type)}</span>
                    <SignalStatusBadge value={signal.status} />
                  </div>
                </div>
                <SignalSeverityBadge value={signal.severity} />
              </div>
              <SourceReference
                module={signal.source.module}
                recordId={signal.source.recordId}
                availability={signal.source.availability}
              />
              {Object.keys(signal.details).length > 0 ? (
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {JSON.stringify(signal.details, null, 2)}
                </pre>
              ) : null}
              {signal.status !== 'open' ? (
                <p className="text-xs text-muted-foreground">
                  {signal.resolution.command ? humanize(signal.resolution.command) : 'Closed'}
                  {signal.resolution.reason ? `: ${signal.resolution.reason}` : ''}
                  {signal.resolution.resolvedAt
                    ? ` · ${new Date(signal.resolution.resolvedAt).toLocaleString()}`
                    : ''}
                </p>
              ) : null}
              {!terminal &&
              signal.status === 'open' &&
              signal.source.availability !== 'missing' &&
              signal.type !== 'match_exception' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void submit({
                        action: 'resolve_signal',
                        expectedVersion: projection.case.version,
                        signalId: signal.id,
                        ...(reason.trim() ? { overrideReason: reason.trim() } : {}),
                      })
                    }
                  >
                    Resolve signal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void submit({
                        action: 'waive_signal',
                        expectedVersion: projection.case.version,
                        signalId: signal.id,
                        reason,
                      })
                    }
                  >
                    Waive signal
                  </Button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </ReviewSection>

      <ReviewSection id="review-provenance" title="Field provenance">
        {projection.provenance.fields.length === 0 ? (
          <EmptyValue>No field provenance has been recorded.</EmptyValue>
        ) : (
          <Card className="overflow-hidden rounded-[28px] border-border/70 bg-card/95">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Availability</TableHead>
                    <TableHead>Current</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projection.provenance.fields.map((field) => (
                    <TableRow key={field.id}>
                      <TableCell className="font-medium">{field.fieldPath}</TableCell>
                      <TableCell>{field.sourceType}</TableCell>
                      <TableCell className="font-mono text-xs">{field.sourceRecordId}</TableCell>
                      <TableCell>
                        {field.confidence === null
                          ? 'Not reported'
                          : `${Math.round(field.confidence * 100)}%`}
                      </TableCell>
                      <TableCell>
                        <Availability value={field.source.availability} />
                      </TableCell>
                      <TableCell>{field.isCurrent ? 'Current' : 'Superseded'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </ReviewSection>

      <div className="grid gap-6 lg:grid-cols-3">
        <ReviewSection id="review-match" title="Match summary">
          <Fact label="Status" value={<StatusBadge value={projection.match.status} />} />
          <Fact label="Exceptions" value={String(projection.match.exceptions.length)} />
          {projection.match.exceptions.map((exception) => (
            <div key={exception.id} className="border-t border-border/70 pt-2 text-xs">
              <span className="font-mono">{exception.id}</span>
              <span className="text-muted-foreground">
                {' '}
                · Price variance {exception.priceVariance} · Quantity variance{' '}
                {exception.quantityVariance} · {exception.variancePct}%
              </span>
            </div>
          ))}
          <pre className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(projection.match.details, null, 2)}
          </pre>
        </ReviewSection>
        <ReviewSection id="review-approvals" title="Approval summary">
          {projection.approvals.length === 0 ? (
            <EmptyValue>No approval requests.</EmptyValue>
          ) : (
            projection.approvals.map((approval) => (
              <div key={approval.id} className="text-sm">
                <Link
                  href={`/approvals/${approval.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  Step {approval.currentStep}
                </Link>
                <span className="ml-2 inline-flex">
                  <StatusBadge value={approval.status} />
                </span>
              </div>
            ))
          )}
        </ReviewSection>
        <ReviewSection id="review-payments" title="Payment summary">
          {projection.payments.length === 0 ? (
            <EmptyValue>No payment records.</EmptyValue>
          ) : (
            projection.payments.map((payment) => (
              <div key={payment.id} className="text-sm">
                <span className="font-medium">{payment.paymentRunId}</span>
                <span className="ml-2 inline-flex">
                  <StatusBadge value={payment.status} />
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatCurrency(payment.amount, payment.currency)}
                </span>
              </div>
            ))
          )}
        </ReviewSection>
      </div>

      <ReviewSection id="review-messages" title="Messages">
        {messageThread ??
          (projection.messages.length === 0 ? (
            <EmptyValue>No invoice messages.</EmptyValue>
          ) : (
            projection.messages.map((item) => (
              <article key={item.id} className="border-b border-border/70 py-3 last:border-0">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="font-medium">{item.authorName}</span>
                  <span className="text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p>
              </article>
            ))
          ))}
      </ReviewSection>

      <ReviewSection id="review-history" title="Case history">
        {projection.history.entries.length === 0 ? (
          <EmptyValue>No case history events.</EmptyValue>
        ) : (
          projection.history.entries.map((entry) => (
            <article
              key={entry.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 py-3 text-sm last:border-0"
            >
              <div>
                <p className="font-medium">{historyActionLabel(entry.action)}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.actor.name} · {humanize(entry.target.type)}{' '}
                  <span className="font-mono">{entry.target.id}</span>
                </p>
              </div>
              <time className="text-xs text-muted-foreground" dateTime={entry.timestamp}>
                {new Date(entry.timestamp).toLocaleString()}
              </time>
            </article>
          ))
        )}
      </ReviewSection>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function historyActionLabel(action: string) {
  return humanize(action.split('.').at(-1) ?? action);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(size % 1024 === 0 ? 0 : 1)} KB`;
}

function ReviewSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 border-t border-border/70 pt-5">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-foreground">{value}</dd>
    </div>
  );
}

const CASE_STATE_BADGES: Record<
  InvoiceReviewProjection['case']['state'],
  { value: string; label: string }
> = {
  open: { value: 'pending', label: 'Open' },
  in_review: { value: 'manually_reviewed', label: 'In review' },
  waiting_on_supplier: { value: 'pending_approval', label: 'Waiting on supplier' },
  resolved: { value: 'approved', label: 'Resolved' },
};

function CaseStateBadge({ value }: { value: InvoiceReviewProjection['case']['state'] }) {
  const badge = CASE_STATE_BADGES[value];
  return <StatusBadge value={badge.value} label={badge.label} />;
}

const SIGNAL_STATUS_BADGES: Record<
  InvoiceReviewProjection['signals'][number]['status'],
  { value: string; label: string }
> = {
  open: { value: 'pending', label: 'Open' },
  resolved: { value: 'approved', label: 'Resolved' },
  waived: { value: 'cancelled', label: 'Waived' },
};

function SignalStatusBadge({
  value,
}: {
  value: InvoiceReviewProjection['signals'][number]['status'];
}) {
  const badge = SIGNAL_STATUS_BADGES[value];
  return <StatusBadge value={badge.value} label={badge.label} />;
}

const SIGNAL_SEVERITY_BADGES: Record<
  InvoiceReviewProjection['signals'][number]['severity'],
  { value: string; label: string }
> = {
  informational: { value: 'informational', label: 'Informational' },
  review_required: { value: 'pending_approval', label: 'Review required' },
  blocking: { value: 'blocked', label: 'Blocking' },
};

function SignalSeverityBadge({
  value,
}: {
  value: InvoiceReviewProjection['signals'][number]['severity'];
}) {
  const badge = SIGNAL_SEVERITY_BADGES[value];
  return <StatusBadge value={badge.value} label={badge.label} />;
}

function EmptyValue({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Availability({ value }: { value: 'present' | 'missing' | 'unknown' }) {
  return (
    <span className={value === 'missing' ? 'font-semibold text-destructive' : undefined}>
      {value === 'missing' ? 'Source missing' : humanize(value)}
    </span>
  );
}

function SourceReference({
  module,
  recordId,
  availability,
}: {
  module: string;
  recordId: string;
  availability: 'present' | 'missing' | 'unknown';
}) {
  return (
    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
      <span>Source: {module}</span>
      <span className="font-mono">{recordId}</span>
      <Availability value={availability} />
    </div>
  );
}
