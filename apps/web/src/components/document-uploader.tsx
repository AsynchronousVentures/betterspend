'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, FileText, Loader2, Trash2, Upload, X } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001';

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(name + '='))
    ?.split('=')[1];
}

interface Document {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  entityType: string;
  entityId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface DocumentUploaderProps {
  entityType: string;
  entityId: string;
  label?: string;
}

export function DocumentUploader({ entityType, entityId, label = 'Documents' }: DocumentUploaderProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = getCookie('bs_token');
      const res = await fetch(
        `${API_BASE}/api/v1/documents?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const data = await res.json();
      setDocs(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    if (entityId) void fetchDocs();
  }, [entityId, fetchDocs]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');
    try {
      const token = getCookie('bs_token');
      const form = new FormData();
      form.append('file', file);
      form.append('entityType', entityType);
      form.append('entityId', entityId);

      const res = await fetch(`${API_BASE}/api/v1/documents/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Upload failed (${res.status})`);
      }

      await fetchDocs();
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDownload(doc: Document) {
    setError('');
    try {
      const token = getCookie('bs_token');
      const res = await fetch(`${API_BASE}/api/v1/documents/${doc.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const { url } = await res.json();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(e.message || 'Download failed');
    }
  }

  async function handleDelete(doc: Document) {
    if (!confirm(`Delete "${doc.filename}"?`)) return;
    setDeletingId(doc.id);
    setError('');
    try {
      const token = getCookie('bs_token');
      const res = await fetch(`${API_BASE}/api/v1/documents/${doc.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border/70 pb-4">
        <CardTitle className="text-base font-semibold">
          {label} {docs.length > 0 ? `(${docs.length})` : ''}
        </CardTitle>
        <div>
          <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden" disabled={uploading} />
          <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} size="sm">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? 'Uploading...' : 'Upload file'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {error ? (
          <Alert variant="destructive" className="flex items-start justify-between gap-3">
            <AlertDescription>{error}</AlertDescription>
            <button
              type="button"
              onClick={() => setError('')}
              className="mt-0.5 inline-flex size-5 items-center justify-center rounded-sm text-current/80 hover:bg-black/5"
            >
              <X className="size-4" />
            </button>
          </Alert>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading documents...
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No documents attached yet. Upload a file to start building the record.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/40 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{doc.filename}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {doc.contentType} • {formatBytes(doc.sizeBytes)} • {formatDate(doc.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => handleDownload(doc)}>
                    <Download className="size-4" />
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deletingId === doc.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
