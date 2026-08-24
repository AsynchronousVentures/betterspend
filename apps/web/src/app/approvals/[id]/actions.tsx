'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiUrl } from '../../../lib/api-url';

interface ApprovalDetailActionsProps {
  id: string;
  status: string;
}

export default function ApprovalDetailActions({ id, status }: ApprovalDetailActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  if (status !== 'pending') return null;

  async function handleApprove() {
    setError('');
    setLoading('approve');
    try {
      const res = await fetch(apiUrl(`/api/v1/approvals/${id}/approve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        throw new Error((err as { message?: string }).message || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    if (!rejectMode) {
      setRejectMode(true);
      return;
    }
    if (!rejectReason.trim()) {
      setError('A reason is required to reject.');
      return;
    }
    setError('');
    setLoading('reject');
    try {
      const res = await fetch(apiUrl(`/api/v1/approvals/${id}/reject`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: rejectReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        throw new Error((err as { message?: string }).message || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(null);
    }
  }

  const isDisabled = loading !== null;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '1.25rem 1.5rem',
      }}
    >
      <h2 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 1rem', color: '#111827' }}>
        Actions
      </h2>

      {rejectMode && (
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: '0.375rem',
            }}
          >
            Rejection reason <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="Explain why this is being rejected..."
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
              outline: 'none',
              background: '#fff',
              color: '#111827',
              resize: 'vertical',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={handleApprove}
          disabled={isDisabled || rejectMode}
          style={{
            background: rejectMode ? '#d1d5db' : '#059669',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '0.625rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: isDisabled || rejectMode ? 'not-allowed' : 'pointer',
            opacity: isDisabled || rejectMode ? 0.6 : 1,
          }}
        >
          {loading === 'approve' ? 'Approving...' : 'Approve'}
        </button>

        <button
          onClick={handleReject}
          disabled={isDisabled}
          style={{
            background: '#fff',
            color: '#dc2626',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            padding: '0.625rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            opacity: isDisabled ? 0.7 : 1,
          }}
        >
          {loading === 'reject'
            ? 'Rejecting...'
            : rejectMode
            ? 'Confirm Rejection'
            : 'Reject'}
        </button>

        {rejectMode && (
          <button
            onClick={() => {
              setRejectMode(false);
              setRejectReason('');
              setError('');
            }}
            disabled={isDisabled}
            style={{
              background: 'transparent',
              color: '#6b7280',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: isDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
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
          {error}
        </div>
      )}
    </div>
  );
}
