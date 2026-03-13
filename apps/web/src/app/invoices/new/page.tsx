'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';

interface PO {
  id: string;
  number: string;
  vendorId: string;
  vendor: { id: string; name: string } | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  lines: Array<{ id: string; lineNumber: string; description: string; quantity: string; unitPrice: string }>;
}

interface InvoiceLine {
  poLineId: string;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxCodeId: string;
  taxInclusive: boolean;
}

interface TaxCode {
  id: string;
  code: string;
  ratePercent: string;
}

interface OcrExtractedLine { description: string; quantity: number; unitPrice: number; }
interface OcrJob {
  id: string; status: string;
  extractedData?: {
    invoiceNumber?: string | null; invoiceDate?: string | null; dueDate?: string | null;
    lines?: OcrExtractedLine[];
  } | null;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [pos, setPOs] = useState<PO[]>([]);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrJobId, setOcrJobId] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.purchaseOrders.list(),
      api.exchangeRates.getBaseCurrency(),
    ])
      .then(([poResult, currencyResult]) => {
        if (poResult.status === 'fulfilled') {
          const data = poResult.value;
          const arr = Array.isArray(data) ? data : (data as any).data ?? [];
          setPOs(arr);
        }

        if (currencyResult.status === 'fulfilled') {
          const orgBaseCurrency = currencyResult.value?.baseCurrency || 'USD';
          setBaseCurrency(orgBaseCurrency);
          setCurrency(orgBaseCurrency);
        }
      })
      .catch(() => {});

    api.taxCodes.list()
      .then((data) => setTaxCodes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handlePOChange = async (poId: string) => {
    if (!poId) {
      setSelectedPO(null);
      setLines([]);
      setVendorId('');
      setCurrency(baseCurrency);
      setExchangeRate('1');
      return;
    }
    const po: PO = await api.purchaseOrders.get(poId) as PO;
    setSelectedPO(po);
    setVendorId(po.vendor?.id ?? po.vendorId);
    setCurrency((po.currency || baseCurrency).toUpperCase());
    setExchangeRate(String(po.exchangeRate ?? '1'));
    setLines((po.lines ?? []).map((l, i) => ({
      poLineId: l.id,
      lineNumber: i + 1,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxCodeId: '',
      taxInclusive: false,
    })));
  };

  const updateLine = (idx: number, field: keyof InvoiceLine, value: string) => {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addLine = () => {
    setLines((prev) => [...prev, { poLineId: '', lineNumber: prev.length + 1, description: '', quantity: '1', unitPrice: '0', taxCodeId: '', taxInclusive: false }]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  function getLineTotal(line: InvoiceLine) {
    const raw = parseFloat(line.quantity || '0') * parseFloat(line.unitPrice || '0');
    const taxCode = taxCodes.find((entry) => entry.id === line.taxCodeId);
    if (!taxCode) return raw;
    const rate = parseFloat(taxCode.ratePercent || '0') / 100;
    return line.taxInclusive ? raw : raw * (1 + rate);
  }

  const subtotal = lines.reduce((sum, line) => sum + getLineTotal(line), 0);

  // OCR: submit file → create OCR job → poll until done → pre-populate form
  async function handleOcrUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    setOcrStatus('Reading file…');
    try {
      // Convert file to base64 for inline Claude Vision extraction
      const base64Data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the "data:...;base64," prefix
          resolve(result.split(',')[1] ?? result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setOcrStatus('Extracting…');
      const storageKey = `inline/${Date.now()}-${file.name}`;
      const job = await api.ocr.createJob({ filename: file.name, contentType: file.type, storageKey, base64Data }) as OcrJob;
      setOcrJobId(job.id);
      setOcrStatus('Extracting…');

      // Poll for completion
      pollRef.current = setInterval(async () => {
        const updated = await api.ocr.getJob(job.id).catch(() => null) as OcrJob | null;
        if (!updated) return;
        if (updated.status === 'done') {
          clearInterval(pollRef.current!);
          setOcrStatus('Done — fields pre-populated below');
          setOcrLoading(false);
          applyOcrData(updated);
        } else if (updated.status === 'failed') {
          clearInterval(pollRef.current!);
          setOcrStatus('Extraction failed — fill in manually');
          setOcrLoading(false);
        }
      }, 1500);
    } catch {
      setOcrStatus('Upload failed');
      setOcrLoading(false);
    }
  }

  function applyOcrData(job: OcrJob) {
    const d = job.extractedData;
    if (!d) return;
    if (d.invoiceNumber) setInvoiceNumber(d.invoiceNumber);
    if (d.invoiceDate) setInvoiceDate(d.invoiceDate.split('T')[0]);
    if (d.dueDate) setDueDate(d.dueDate.split('T')[0]);
    if (d.lines && d.lines.length > 0) {
      setLines(d.lines.map((l, i) => ({
        poLineId: '', lineNumber: i + 1,
        description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), taxCodeId: '', taxInclusive: false,
      })));
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const inv = await api.invoices.create({
        purchaseOrderId: selectedPO?.id || undefined,
        vendorId,
        invoiceNumber,
        invoiceDate,
        currency,
        exchangeRate: parseFloat(exchangeRate || '1') || 1,
        dueDate: dueDate || undefined,
        lines: lines.map((l) => ({
          poLineId: l.poLineId || undefined,
          taxCodeId: l.taxCodeId || undefined,
          taxInclusive: l.taxInclusive,
          lineNumber: l.lineNumber,
          description: l.description,
          quantity: parseFloat(l.quantity),
          unitPrice: parseFloat(l.unitPrice),
        })),
      }) as any;
      router.push(`/invoices/${inv.id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' as const };
  const labelStyle = { display: 'block' as const, fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' };

  return (
    <div style={{ padding: '2rem', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', color: COLORS.textPrimary }}>Create Invoice</h1>

      {/* OCR Upload */}
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#0369a1' }}>Upload Invoice (OCR)</div>
          <div style={{ fontSize: '0.8rem', color: '#0284c7', marginTop: '2px' }}>
            Upload a PDF or image to auto-extract invoice fields
            {ocrStatus && <span style={{ marginLeft: '0.5rem', color: ocrLoading ? '#0369a1' : '#059669', fontWeight: 500 }}>— {ocrStatus}</span>}
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={handleOcrUpload} />
        <button
          type="button"
          disabled={ocrLoading}
          onClick={() => fileInputRef.current?.click()}
          style={{ background: '#0369a1', color: COLORS.white, border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: ocrLoading ? 'not-allowed' : 'pointer', opacity: ocrLoading ? 0.7 : 1, whiteSpace: 'nowrap' }}
        >
          {ocrLoading ? 'Processing…' : 'Choose File'}
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Header */}
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: COLORS.textPrimary }}>Invoice Details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Link to Purchase Order (optional)</label>
              <select onChange={(e) => handlePOChange(e.target.value)} style={inputStyle}>
                <option value="">No PO (standalone invoice)</option>
                {pos.map((po) => (
                  <option key={po.id} value={po.id}>{po.number} — {po.vendor?.name ?? 'Unknown'}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Vendor Invoice Number *</label>
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required style={inputStyle} placeholder="e.g. INV-20240115" />
            </div>

            <div>
              <label style={labelStyle}>Invoice Date *</label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Currency</label>
              <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Exchange Rate to {baseCurrency}</label>
              <input type="number" min="0" step="0.000001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', color: COLORS.textMuted, marginTop: '1rem' }}>
            Organization base currency is {baseCurrency}. Linked POs default the invoice currency and exchange rate.
          </div>
        </div>

        {/* Lines */}
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: COLORS.textPrimary }}>Line Items</h2>
            <button type="button" onClick={addLine} style={{ fontSize: '0.8rem', color: COLORS.accentBlueDark, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
              + Add Line
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  {['#', 'Description', 'Qty', 'Unit Price', 'Total', ''].map((h) => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} style={{ borderBottom: idx < lines.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: COLORS.textSecondary, width: '40px' }}>{idx + 1}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <input value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} required style={{ ...inputStyle, width: '100%' }} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', marginTop: '0.4rem', alignItems: 'center' }}>
                        <select value={line.taxCodeId} onChange={(e) => updateLine(idx, 'taxCodeId', e.target.value)} style={{ ...inputStyle, fontSize: '0.8rem', padding: '0.4rem 0.5rem' }}>
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
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', width: '80px' }}>
                      <input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} required style={{ ...inputStyle, width: '80px' }} />
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', width: '100px' }}>
                      <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)} required style={{ ...inputStyle, width: '100px' }} />
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: COLORS.textSecondary, width: '90px' }}>
                      ${getLineTotal(line).toFixed(2)}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', width: '30px' }}>
                      <button type="button" onClick={() => removeLine(idx)} style={{ color: COLORS.accentRed, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: COLORS.textMuted }}>No lines. Add a line or select a PO above.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${COLORS.tableBorder}` }}>
                  <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: COLORS.textSecondary }}>Total</td>
                  <td colSpan={2} style={{ padding: '0.75rem', fontWeight: 700, color: COLORS.textPrimary }}>
                    ${subtotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {error && (
          <div style={{ background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem', color: COLORS.accentRedDark, fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="submit"
            disabled={loading || !invoiceNumber || lines.length === 0}
            style={{ background: loading ? COLORS.textMuted : COLORS.textPrimary, color: COLORS.white, padding: '0.625rem 1.5rem', borderRadius: '6px', border: 'none', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            {loading ? 'Creating...' : 'Create Invoice'}
          </button>
          <a href="/invoices" style={{ padding: '0.625rem 1.5rem', borderRadius: '6px', border: `1px solid ${COLORS.inputBorder}`, fontSize: '0.875rem', color: COLORS.textSecondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
