'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiUrl } from '../../../lib/api-url';

interface RequisitionActionsProps {
  id: string;
  status: string;
}

export default function RequisitionActions({ id, status }: RequisitionActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function doAction(action: 'submit' | 'cancel') {
    setError('');
    setLoading(action);
    try {
      const res = await fetch(apiUrl(`/api/v1/requisitions/${id}/${action}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(null);
    }
  }

  const canSubmit = status === 'draft';
  const canCancel = status === 'draft' || status === 'pending_approval';

  if (!canSubmit && !canCancel) return null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {canSubmit && (
          <button
            onClick={() => doAction('submit')}
            disabled={loading !== null}
            style={{
              background: '#059669',
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
            {loading === 'submit' ? 'Submitting...' : 'Submit for Approval'}
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => doAction('cancel')}
            disabled={loading !== null}
            style={{
              background: '#fff',
              color: '#dc2626',
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: loading !== null ? 'not-allowed' : 'pointer',
              opacity: loading !== null ? 0.7 : 1,
            }}
          >
            {loading === 'cancel' ? 'Cancelling...' : 'Cancel Requisition'}
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
