'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

export default function VendorsPage() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.vendors.list().then(setVendors).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = vendors.filter(
    (vendor) =>
      !search ||
      vendor.name.toLowerCase().includes(search.toLowerCase()) ||
      (vendor.code || '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Vendors"
        description="Supplier master records, payment terms, and onboarding status in one place."
        actions={
          <>
            <div className="relative min-w-[260px] flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search vendors or codes"
                className="pl-9"
              />
            </div>
            <Button asChild>
              <Link href="/vendors/new">
                <Plus className="h-4 w-4" />
                New Vendor
              </Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading vendors...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No vendors found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search ? 'Try a broader search term.' : 'Create your first supplier record to start purchasing.'}
                </p>
              </div>
              {!search ? (
                <Button asChild variant="outline">
                  <Link href="/vendors/new">Create vendor</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Payment Terms</TableHead>
                  <TableHead>Tax ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((vendor) => (
                  <TableRow
                    key={vendor.id}
                    className="cursor-pointer"
                    onClick={() => {
                      window.location.href = `/vendors/${vendor.id}`;
                    }}
                  >
                    <TableCell className="font-semibold text-foreground">{vendor.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{vendor.code || '—'}</TableCell>
                    <TableCell>
                      <StatusBadge value={vendor.status || 'inactive'} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vendor.contactInfo?.email ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{vendor.paymentTerms ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{vendor.taxId ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
