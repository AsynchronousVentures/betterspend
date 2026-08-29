'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Boxes, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

function fmtQty(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function InventoryPageInner() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(searchParams.get('lowStockOnly') === 'true');

  useEffect(() => {
    setLoading(true);
    api.inventory
      .list({ lowStockOnly })
      .then(setItems)
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [lowStockOnly]);

  const filtered = items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.sku?.toLowerCase().includes(q) ||
      item.name?.toLowerCase().includes(q) ||
      item.location?.toLowerCase().includes(q)
    );
  });

  const lowStockCount = items.filter((item) => item.stockStatus === 'low_stock' || item.stockStatus === 'out_of_stock').length;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-sm font-semibold">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!lowStockOnly && !loading && lowStockCount > 0 ? (
        <Alert variant="warning">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              <strong>Warning:</strong> {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} below reorder point.
            </span>
            <button onClick={() => setLowStockOnly(true)} className="text-sm font-semibold underline">
              Show low-stock only
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="Inventory"
        description="Track stock levels, reserved quantities, and reorder exposure across locations."
        actions={
          <>
            <div className="relative min-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search SKU, name, location..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />
              Low stock only
            </label>
            <Button asChild>
              <Link href="/inventory/new">
                <Plus className="h-4 w-4" />
                New Item
              </Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading inventory...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <Boxes className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  {items.length === 0 ? 'No inventory items yet' : 'No items match your search'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {items.length === 0 ? 'Create your first stocked item to start tracking availability.' : 'Try adjusting the current filters.'}
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Reorder Point</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => {
                  const isLowStock = item.stockStatus === 'low_stock' || item.stockStatus === 'out_of_stock';
                  return (
                    <TableRow
                      key={item.id}
                      className={isLowStock ? 'cursor-pointer bg-amber-50/60 hover:bg-amber-50' : 'cursor-pointer'}
                      onClick={() => {
                        window.location.href = `/inventory/${item.id}`;
                      }}
                    >
                      <TableCell className="font-mono text-xs font-semibold text-primary">{item.sku}</TableCell>
                      <TableCell className="max-w-[260px] font-semibold text-foreground">
                        <span className="block truncate">{item.name}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.unit ?? 'each'}</TableCell>
                      <TableCell className="text-right font-medium text-foreground">{fmtQty(item.quantityOnHand)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtQty(item.quantityReserved)}</TableCell>
                      <TableCell className="text-right font-medium text-foreground">{fmtQty(item.quantityAvailable)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {item.reorderPoint != null ? fmtQty(item.reorderPoint) : '—'}
                      </TableCell>
                      <TableCell className="max-w-[180px] text-muted-foreground">
                        <span className="block truncate">{item.location ?? '—'}</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={item.stockStatus} label={item.stockStatus === 'ok' ? 'OK' : undefined} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading...</div>}>
      <InventoryPageInner />
    </Suspense>
  );
}
