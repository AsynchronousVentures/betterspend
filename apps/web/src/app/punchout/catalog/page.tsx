'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, LoaderCircle, Search, ShoppingCart } from 'lucide-react';
import { api } from '../../../lib/api';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';

interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unitPrice: string;
  unitOfMeasure: string;
  currency: string;
  category: string | null;
}

interface CartItem {
  item: CatalogItem;
  quantity: number;
}

function formatPrice(price: string | number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(price));
}

export default function PunchoutCatalogPage() {
  const searchParams = useSearchParams();
  const session = searchParams.get('session') ?? '';
  const vendorId = searchParams.get('vendor') ?? '';

  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<any | null>(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    async function init() {
      if (!session || !vendorId) {
        setSessionValid(false);
        setLoading(false);
        return;
      }
      try {
        const sessionInfo = await api.punchout.getSession(session);
        setSessionValid(sessionInfo.valid);
        if (!sessionInfo.valid) {
          setLoading(false);
          return;
        }

        const data = await api.catalog.list({ vendorId });
        setItems((data as CatalogItem[]).filter((item: any) => item.isActive));
      } catch {
        setSessionValid(false);
      } finally {
        setLoading(false);
      }
    }

    void init();
  }, [session, vendorId]);

  const filtered = items.filter(
    (item) =>
      !searchQ ||
      item.name.toLowerCase().includes(searchQ.toLowerCase()) ||
      (item.sku ?? '').toLowerCase().includes(searchQ.toLowerCase()) ||
      (item.category ?? '').toLowerCase().includes(searchQ.toLowerCase()),
  );

  function addToCart(item: CatalogItem) {
    setCart((current) => {
      const existing = current.find((entry) => entry.item.id === item.id);
      if (existing) {
        return current.map((entry) =>
          entry.item.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }
      return [...current, { item, quantity: 1 }];
    });
  }

  function updateQty(itemId: string, qty: number) {
    if (qty <= 0) {
      setCart((current) => current.filter((entry) => entry.item.id !== itemId));
      return;
    }

    setCart((current) =>
      current.map((entry) => (entry.item.id === itemId ? { ...entry, quantity: qty } : entry)),
    );
  }

  const cartTotal = cart.reduce((sum, entry) => sum + parseFloat(entry.item.unitPrice) * entry.quantity, 0);

  async function checkout() {
    if (cart.length === 0) return;
    setCheckingOut(true);
    try {
      const orderMessage = {
        buyerCookie: session,
        itemIn: cart.map((entry) => ({
          supplierPartId: entry.item.sku ?? entry.item.id,
          description: entry.item.name,
          quantity: entry.quantity,
          unitPrice: parseFloat(entry.item.unitPrice),
          unitOfMeasure: entry.item.unitOfMeasure,
          currency: entry.item.currency,
        })),
      };
      const result = await api.punchout.orderReturn(session, orderMessage);
      setCheckoutResult(result);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] px-4">
        <div className="flex items-center gap-3 rounded-full border border-border/70 bg-card/80 px-5 py-3 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Loading catalog...
        </div>
      </div>
    );
  }

  if (!sessionValid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] px-4">
        <Card className="w-full max-w-xl rounded-[30px] border-border/70 bg-card/95">
          <CardContent className="flex flex-col items-center gap-5 px-8 py-14 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-amber-50 text-amber-700">
              <AlertTriangle className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
                Invalid or Expired Session
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                This punchout session is no longer valid. Restart the punchout from your procurement system.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (checkoutResult) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <Card className="rounded-[30px] border-border/70 bg-card/95">
            <CardContent className="space-y-6 px-8 py-10">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-emerald-50 text-emerald-700">
                  <Check className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-emerald-700">
                    Items Sent to Requisition
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {checkoutResult.lines?.length ?? 0} line(s) were returned to your procurement system. You may close this window.
                  </p>
                </div>
              </div>
              <Card className="rounded-[24px] bg-emerald-50/60">
                <CardContent className="grid gap-3 p-5">
                  {(checkoutResult.lines ?? []).map((line: any, index: number) => (
                    <div key={index} className="flex items-center justify-between gap-4 border-b border-emerald-200/80 pb-3 text-sm last:border-0 last:pb-0">
                      <span className="text-muted-foreground">
                        {line.description} x {line.quantity}
                      </span>
                      <span className="font-semibold text-emerald-700">
                        {(line.unitPrice * line.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)]">
      <div className="border-b border-slate-900/10 bg-slate-950 text-slate-50 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.75)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-200/80">
              Punchout Catalog
            </div>
            <div className="font-display text-3xl font-semibold tracking-[-0.04em]">Vendor Catalog</div>
          </div>
          <div className="flex items-center gap-3">
            {cart.length > 0 ? (
              <div className="rounded-full border border-slate-700/80 bg-slate-900/60 px-4 py-2 text-sm text-slate-200">
                Cart: {cart.length} item{cart.length !== 1 ? 's' : ''} · {cartTotal.toFixed(2)}
              </div>
            ) : null}
            <Button type="button" onClick={checkout} disabled={cart.length === 0 || checkingOut} className="gap-2 bg-sky-500 text-white hover:bg-sky-400">
              <ShoppingCart className="h-4 w-4" />
              {checkingOut ? 'Checking out...' : `Checkout (${cart.length})`}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 md:px-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {checkoutError ? (
            <Alert variant="destructive">
              <AlertDescription>{checkoutError}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="rounded-[28px]">
            <CardHeader>
              <CardTitle className="text-xl">Browse catalog</CardTitle>
              <CardDescription>Search by name, SKU, or category, then send selected lines back into the requisition flow.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQ}
                  onChange={(event) => setSearchQ(event.target.value)}
                  placeholder="Search catalog..."
                  className="pl-9"
                />
              </div>

              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-14 text-center text-sm text-muted-foreground">
                  {items.length === 0 ? 'No catalog items available for this vendor.' : 'No items match your search.'}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((item) => {
                    const inCart = cart.find((entry) => entry.item.id === item.id);
                    return (
                      <Card
                        key={item.id}
                        className={`rounded-[24px] border-border/70 bg-card/95 ${
                          inCart ? 'border-sky-300 shadow-[0_18px_52px_-36px_rgba(14,165,233,0.45)]' : ''
                        }`}
                      >
                        <CardContent className="flex h-full flex-col gap-4 p-5">
                          <div className="space-y-3">
                            {item.category ? <Badge variant="outline">{item.category}</Badge> : null}
                            <div className="space-y-1">
                              <div className="font-semibold text-foreground">{item.name}</div>
                              {item.sku ? (
                                <div className="font-mono text-xs text-muted-foreground">SKU: {item.sku}</div>
                              ) : null}
                            </div>
                            {item.description ? (
                              <div className="text-sm text-muted-foreground">{item.description}</div>
                            ) : null}
                          </div>

                          <div className="mt-auto flex items-end justify-between gap-4">
                            <div>
                              <div className="text-lg font-semibold text-emerald-700">
                                {formatPrice(item.unitPrice, item.currency)}
                              </div>
                              <div className="text-xs text-muted-foreground">per {item.unitOfMeasure}</div>
                            </div>
                            {inCart ? (
                              <div className="flex items-center gap-2">
                                <Button type="button" size="icon" variant="outline" onClick={() => updateQty(item.id, inCart.quantity - 1)}>
                                  -
                                </Button>
                                <span className="min-w-6 text-center text-sm font-semibold text-foreground">
                                  {inCart.quantity}
                                </span>
                                <Button type="button" size="icon" variant="outline" onClick={() => updateQty(item.id, inCart.quantity + 1)}>
                                  +
                                </Button>
                              </div>
                            ) : (
                              <Button type="button" onClick={() => addToCart(item)}>
                                Add
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="sticky top-6 rounded-[28px] self-start">
          <CardHeader>
            <CardTitle className="text-xl">Cart ({cart.length})</CardTitle>
            <CardDescription>Review selected items before sending them back to the requisition flow.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
                No items yet.
              </div>
            ) : (
              <>
                <div className="grid gap-3">
                  {cart.map((entry) => (
                    <div key={entry.item.id} className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{entry.item.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {entry.quantity} x {formatPrice(entry.item.unitPrice, entry.item.currency)}
                          </div>
                        </div>
                        <Button type="button" size="icon" variant="ghost" onClick={() => updateQty(entry.item.id, 0)}>
                          ×
                        </Button>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Line total</span>
                        <span className="font-semibold text-foreground">
                          {formatPrice(parseFloat(entry.item.unitPrice) * entry.quantity, entry.item.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-border/70 pt-4 text-base font-semibold text-foreground">
                  <span>Total</span>
                  <span>{cartTotal.toFixed(2)}</span>
                </div>
                <Button type="button" onClick={checkout} disabled={checkingOut} className="w-full gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  {checkingOut ? 'Checking out...' : 'Send to Requisition'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
