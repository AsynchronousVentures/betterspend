'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { apiUrl } from '../../../lib/api-url';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { restoreFocus } from '../../../lib/accessibility';

interface POActionsProps {
  id: string;
  status: string;
  pdfUrl: string;
}

export default function POActions({ id, status, pdfUrl }: POActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // Change order dialog
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [changeSubmitting, setChangeSubmitting] = useState(false);
  const [changeError, setChangeError] = useState('');
  const changeDialogTriggerRef = useRef<HTMLButtonElement>(null);

  const canIssue = status === 'draft' || status === 'approved';
  const canChangeOrder = status !== 'closed' && status !== 'cancelled';

  async function issuePO() {
    setActionError('');
    setLoading('issue');
    try {
      const res = await fetch(apiUrl(`/api/v1/purchase-orders/${id}/issue`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(null);
    }
  }

  async function submitChangeOrder() {
    if (!changeReason.trim()) {
      setChangeError('Change reason is required.');
      return;
    }
    setChangeError('');
    setChangeSubmitting(true);
    try {
      const res = await fetch(apiUrl(`/api/v1/purchase-orders/${id}/change-order`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeReason: changeReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      setChangeDialogOpen(false);
      setChangeReason('');
      router.refresh();
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setChangeSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {canIssue && (
          <button
            onClick={issuePO}
            disabled={loading !== null}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: loading !== null ? 'not-allowed' : 'pointer',
              opacity: loading !== null ? 0.7 : 1,
            }}
          >
            {loading === 'issue' ? 'Issuing...' : 'Issue PO'}
          </button>
        )}

        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: '#fff',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            padding: '0.625rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Download PDF
        </a>

        {canChangeOrder && (
          <button
            ref={changeDialogTriggerRef}
            onClick={() => setChangeDialogOpen(true)}
            disabled={loading !== null}
            style={{
              background: '#fff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Change Order
          </button>
        )}
      </div>

      {actionError && (
        <div
          style={{
            marginTop: '0.75rem',
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            padding: '0.625rem 1rem',
            color: '#991b1b',
            fontSize: '0.875rem',
          }}
        >
          {actionError}
        </div>
      )}

      <Dialog
        open={changeDialogOpen}
        onOpenChange={(open) => {
          setChangeDialogOpen(open);
          if (!open) setChangeError('');
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(changeDialogTriggerRef.current);
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Change Order</DialogTitle>
            <DialogDescription>
              Describe the reason for this change order. A new version of the PO will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="po-action-change-reason"
              className="text-sm font-semibold text-foreground"
            >
              Change Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              id="po-action-change-reason"
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
              rows={4}
              placeholder="e.g. Updated pricing agreed with vendor on 2026-03-10"
              className="flex min-h-20 w-full rounded-md border border-input bg-white/80 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </div>
          {changeError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {changeError}
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setChangeDialogOpen(false);
                setChangeReason('');
                setChangeError('');
              }}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitChangeOrder}
              disabled={changeSubmitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {changeSubmitting ? 'Submitting...' : 'Submit Change Order'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
