'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';

interface Vendor {
  id: string;
  name: string;
}

interface LineItem {
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  taxCodeId: string;
  taxInclusive: boolean;
}

interface TaxCode {
  id: string;
  code: string;
  ratePercent: string;
}

interface ComplianceResult {
  status: 'compliant' | 'deviation' | 'no_contract' | 'exempt';
  deltaPercent: number | null;
  contractId: string | null;
  contractedUnitPrice: number | null;
  contractNumber?: string | null;
  deviationAction?: string;
  deviationThreshold?: number;
}

const EMPTY_LINE: LineItem = { description: '', qty: '1', uom: 'each', unitPrice: '0', taxCodeId: '', taxInclusive: false };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  outline: 'none',
  background: COLORS.white,
  color: COLORS.textPrimary,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: COLORS.textSecondary,
  marginBottom: '0.375rem',
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function ComplianceBadge({
  result,
  deviationThreshold,
}: {
  result: ComplianceResult | null | undefined;
  deviationThreshold: number;
}) {
  if (!result) return null;

  if (result.status === 'no_contract') {
    return (
      <span
        style={{
          display: 'inline-block',
          fontSize: '0.7rem',
          fontWeight: 600,
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          background: COLORS.hoverBg,
          color: COLORS.textMuted,
          border: `1px solid ${COLORS.border}`,
          whiteSpace: 'nowrap',
        }}
      >
        No contract
      </span>
    );
  }

  if (result.status === 'compliant') {
    return (
      <span
        style={{
          display: 'inline-block',
          fontSize: '0.7rem',
          fontWeight: 600,
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          background: COLORS.accentGreenLight,
          color: COLORS.accentGreenDark,
          border: '1px solid #bbf7d0',
          whiteSpace: 'nowrap',
        }}
      >
        Contract: {formatCurrency(result.contractedUnitPrice ?? 0)}
      </span>
    );
  }

  if (result.status === 'deviation') {
    const delta = result.deltaPercent ?? 0;
    const exceeded = delta > deviationThreshold;
    const isBlock = result.deviationAction === 'block';
    const severe = exceeded && isBlock;

    return (
      <span
        style={{
          display: 'inline-block',
          fontSize: '0.7rem',
          fontWeight: 600,
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          background: severe ? COLORS.accentRedLight : COLORS.accentAmberLight,
          color: severe ? COLORS.accentRedDark : COLORS.accentAmberDark,
          border: `1px solid ${severe ? '#fca5a5' : '#fde68a'}`,
          whiteSpace: 'nowrap',
        }}
      >
        {severe ? '\u26d4' : '\u26a0'} Contract: {formatCurrency(result.contractedUnitPrice ?? 0)} (+{delta.toFixed(1)}%)
      </span>
    );
  }

  return null;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();

  // Vendors
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  // Form state
  const [vendorId, setVendorId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Compliance state per line
  const [lineCompliance, setLineCompliance] = useState<Array<ComplianceResult | null>>([null]);
  const [deviationThreshold, setDeviationThreshold] = useState(5);
  const [deviationAction, setDeviationAction] = useState('warn');
  const debounceTimers = useRef<Array<ReturnType<typeof setTimeout> | null>>([null]);

  useEffect(() => {
    api.vendors.list()
      .then((data) => {
        const list: Vendor[] = Array.isArray(data) ? data : (data as any).data ?? [];
        setVendors(list);
        if (list.length > 0) setVendorId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setVendorsLoading(false));

    api.taxCodes.list()
      .then((data) => setTaxCodes(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Load deviation threshold from settings
    api.settings.getAll()
      .then((all) => {
        const threshold = parseFloat(all.contract_price_deviation_threshold || '5');
        const action = all.contract_price_deviation_action || 'warn';
        if (!isNaN(threshold)) setDeviationThreshold(threshold);
        setDeviationAction(action);
      })
      .catch(() => {});
  }, []);

  const runComplianceCheck = useCallback(
    (lineIdx: number, vid: string, price: number, desc: string) => {
      if (!vid || isNaN(price) || price <= 0) {
        setLineCompliance((prev) => {
          const next = [...prev];
          next[lineIdx] = null;
          return next;
        });
        return;
      }

      // Clear existing timer for this line
      if (debounceTimers.current[lineIdx]) {
        clearTimeout(debounceTimers.current[lineIdx]!);
      }

      debounceTimers.current[lineIdx] = setTimeout(async () => {
        try {
          const result = await api.purchaseOrders.checkCompliance({
            vendorId: vid,
            unitPrice: price,
            description: desc || undefined,
          });
          setLineCompliance((prev) => {
            const next = [...prev];
            next[lineIdx] = result;
            return next;
          });
          if (result.deviationThreshold != null) setDeviationThreshold(result.deviationThreshold);
          if (result.deviationAction) setDeviationAction(result.deviationAction);
        } catch {
          // silent fail
        }
      }, 600);
    },
    [],
  );

  // Re-run compliance checks when vendor changes
  useEffect(() => {
    if (!vendorId) return;
    lines.forEach((line, idx) => {
      const price = parseFloat(line.unitPrice);
      if (!isNaN(price) && price > 0) {
        runComplianceCheck(idx, vendorId, price, line.description);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  function getLineTotal(line: LineItem) {
    const raw = (parseFloat(line.qty) || 0) * (parseFloat(line.unitPrice) || 0);
    const taxCode = taxCodes.find((entry) => entry.id === line.taxCodeId);
    if (!taxCode) return raw;
    const rate = parseFloat(taxCode.ratePercent || '0') / 100;
    return line.taxInclusive ? raw : raw * (1 + rate);
  }

  const total = lines.reduce((sum, line) => sum + getLineTotal(line), 0);

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    setLineCompliance((prev) => [...prev, null]);
    debounceTimers.current.push(null);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setLineCompliance((prev) => prev.filter((_, i) => i !== idx));
    debounceTimers.current = debounceTimers.current.filter((_, i) => i !== idx);
  }

  function updateLine(idx: number, field: keyof LineItem, value: string) {
    setLines((prev) =>
      prev.map((line, i) => (i === idx ? { ...line, [field]: value } : line)),
    );

    if (field === 'unitPrice' || field === 'description') {
      const updatedLine = { ...lines[idx], [field]: value };
      const price = parseFloat(field === 'unitPrice' ? value : updatedLine.unitPrice);
      const desc = field === 'description' ? value : updatedLine.description;
      if (vendorId) {
        runComplianceCheck(idx, vendorId, price, desc);
      }
    }
  }

  // Check if any line has a 'block' level deviation
  const hasBlockingDeviation = deviationAction === 'block' &&
    lineCompliance.some((c) => c?.status === 'deviation' && (c.deltaPercent ?? 0) > deviationThreshold);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!vendorId) {
      setError('Please select a vendor.');
      return;
    }
    if (lines.length === 0) {
      setError('At least one line item is required.');
      return;
    }
    if (hasBlockingDeviation) {
      setError('One or more line items exceed the contract price deviation threshold. Please correct the prices or contact your administrator.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        vendorId,
        paymentTerms: paymentTerms.trim() || undefined,
        currency,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: parseFloat(l.qty) || 1,
          unitOfMeasure: l.uom || 'each',
          unitPrice: parseFloat(l.unitPrice) || 0,
          taxCodeId: l.taxCodeId || undefined,
          taxInclusive: l.taxInclusive,
        })),
      };

      await api.purchaseOrders.create(payload);
      router.push('/purchase-orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link
          href="/purchase-orders"
          style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}
        >
          &larr; Back to Purchase Orders
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.5rem 0 0', color: COLORS.textPrimary }}>
          New Purchase Order
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Details card */}
        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.tableBorder}`,
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '1.25rem',
            boxShadow: SHADOWS.card,
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 1.25rem', color: COLORS.textPrimary }}>
            Details
          </h2>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {/* Vendor select */}
            <div>
              <label style={labelStyle}>
                Vendor <span style={{ color: COLORS.accentRed }}>*</span>
              </label>
              {vendorsLoading ? (
                <div style={{ fontSize: '0.875rem', color: COLORS.textMuted, padding: '0.5rem 0' }}>
                  Loading vendors...
                </div>
              ) : vendors.length === 0 ? (
                <div style={{ fontSize: '0.875rem', color: COLORS.accentRed, padding: '0.5rem 0' }}>
                  No vendors found. Please{' '}
                  <Link href="/vendors/new" style={{ color: COLORS.accentBlueDark }}>
                    create a vendor
                  </Link>{' '}
                  first.
                </div>
              ) : (
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  style={inputStyle}
                  required
                >
                  <option value="">-- Select vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Payment terms / currency row */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Payment Terms</label>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="e.g. Net 30"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Currency</label>
                <input
                  type="text"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional internal notes"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          </div>
        </div>

        {/* Line items card */}
        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.tableBorder}`,
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '1.25rem',
            boxShadow: SHADOWS.card,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}
          >
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: COLORS.textPrimary }}>
              Line Items
            </h2>
            <button
              type="button"
              onClick={addLine}
              style={{
                background: 'transparent',
                border: `1px solid ${COLORS.inputBorder}`,
                borderRadius: '6px',
                padding: '0.375rem 0.875rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
                color: COLORS.textSecondary,
                fontWeight: 500,
              }}
            >
              + Add Line
            </button>
          </div>

          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '3fr 80px 80px 130px 120px 40px',
              gap: '0.5rem',
              marginBottom: '0.5rem',
            }}
          >
            {['Description', 'Qty', 'UOM', 'Unit Price', 'Total', ''].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: COLORS.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {lines.map((line, idx) => {
            const lineTotal = getLineTotal(line);
            const compliance = lineCompliance[idx];
            return (
              <div key={idx} style={{ marginBottom: '0.625rem' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '3fr 80px 80px 130px 120px 40px',
                    gap: '0.5rem',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      placeholder="Item description"
                      style={inputStyle}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', marginTop: '0.4rem', alignItems: 'center' }}>
                      <select
                        value={line.taxCodeId}
                        onChange={(e) => updateLine(idx, 'taxCodeId', e.target.value)}
                        style={{ ...inputStyle, fontSize: '0.8rem', padding: '0.4rem 0.5rem' }}
                      >
                        <option value="">No tax code</option>
                        {taxCodes.map((taxCode) => (
                          <option key={taxCode.id} value={taxCode.id}>
                            {taxCode.code} ({taxCode.ratePercent}%)
                          </option>
                        ))}
                      </select>
                      <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.75rem', color: COLORS.textSecondary }}>
                        <input
                          type="checkbox"
                          checked={line.taxInclusive}
                          onChange={(e) =>
                            setLines((prev) => prev.map((entry, entryIdx) => (
                              entryIdx === idx ? { ...entry, taxInclusive: e.target.checked } : entry
                            )))
                          }
                        />
                        Incl.
                      </label>
                    </div>
                  </div>
                  <input
                    type="number"
                    value={line.qty}
                    min="0"
                    step="any"
                    onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                    style={inputStyle}
                  />
                  <input
                    type="text"
                    value={line.uom}
                    onChange={(e) => updateLine(idx, 'uom', e.target.value)}
                    placeholder="each"
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    value={line.unitPrice}
                    min="0"
                    step="any"
                    onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)}
                    style={inputStyle}
                  />
                  <div
                    style={{
                      fontSize: '0.875rem',
                      color: COLORS.textSecondary,
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                      paddingRight: '0.25rem',
                    }}
                  >
                    {formatCurrency(lineTotal)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                      color: lines.length === 1 ? COLORS.inputBorder : COLORS.accentRed,
                      fontSize: '1rem',
                      padding: '0.25rem',
                    }}
                    title="Remove line"
                  >
                    &times;
                  </button>
                </div>
                {/* Compliance badge row */}
                {compliance && (
                  <div style={{ paddingLeft: '0', marginTop: '0.25rem' }}>
                    <ComplianceBadge result={compliance} deviationThreshold={deviationThreshold} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Total row */}
          <div
            style={{
              borderTop: `1px solid ${COLORS.tableBorder}`,
              marginTop: '0.75rem',
              paddingTop: '0.75rem',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '1rem',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: COLORS.textSecondary }}>Total</span>
            <span
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: COLORS.textPrimary,
                fontVariantNumeric: 'tabular-nums',
                minWidth: '120px',
                textAlign: 'right',
              }}
            >
              {formatCurrency(total)}
            </span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: COLORS.accentRedLight,
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              color: COLORS.accentRedDark,
              fontSize: '0.875rem',
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}

        {/* Blocking deviation warning */}
        {hasBlockingDeviation && (
          <div
            style={{
              background: COLORS.accentRedLight,
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              color: COLORS.accentRedDark,
              fontSize: '0.875rem',
              marginBottom: '1rem',
              fontWeight: 500,
            }}
          >
            One or more line prices exceed the contract deviation threshold ({deviationThreshold}%). Submission is blocked. Please correct prices or contact your administrator.
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="submit"
            disabled={submitting || vendorsLoading || hasBlockingDeviation}
            style={{
              background: COLORS.textPrimary,
              color: COLORS.white,
              border: 'none',
              borderRadius: '6px',
              padding: '0.625rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: submitting || vendorsLoading || hasBlockingDeviation ? 'not-allowed' : 'pointer',
              opacity: submitting || vendorsLoading || hasBlockingDeviation ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving...' : 'Create Purchase Order'}
          </button>
          <Link
            href="/purchase-orders"
            style={{
              background: COLORS.white,
              color: COLORS.textSecondary,
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: '6px',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
