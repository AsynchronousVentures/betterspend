'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiUrl } from '../../../lib/api-url';

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

      {/* Change Order Dialog */}
      {changeDialogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setChangeDialogOpen(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '1.75rem',
              width: '100%',
              maxWidth: '480px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            }}
          >
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
              Create Change Order
            </h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#6b7280' }}>
              Describe the reason for this change order. A new version of the PO will be created.
            </p>

            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#374151',
                marginBottom: '0.375rem',
              }}
            >
              Change Reason <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              rows={4}
              placeholder="e.g. Updated pricing agreed with vendor on 2026-03-10"
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
                resize: 'vertical',
                outline: 'none',
                color: '#111827',
              }}
            />

            {changeError && (
              <div
                style={{
                  marginTop: '0.75rem',
                  background: '#fee2e2',
                  border: '1px solid #fca5a5',
                  borderRadius: '6px',
                  padding: '0.5rem 0.75rem',
                  color: '#991b1b',
                  fontSize: '0.8rem',
                }}
              >
                {changeError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setChangeDialogOpen(false);
                  setChangeReason('');
                  setChangeError('');
                }}
                style={{
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitChangeOrder}
                disabled={changeSubmitting}
                style={{
                  background: '#111827',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.5rem 1.25rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: changeSubmitting ? 'not-allowed' : 'pointer',
                  opacity: changeSubmitting ? 0.7 : 1,
                }}
              >
                {changeSubmitting ? 'Submitting...' : 'Submit Change Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
