'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { QboExternalEntityMapping } from '@betterspend/shared';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  Link2,
  RefreshCw,
  Search,
  Unlink,
} from 'lucide-react';
import { api, loadFailureState } from '../../lib/api';
import { useAccess } from '../../components/access-provider';
import { ListState } from '../../components/resource-state';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import {
  catalogSearchText,
  mappingCode,
  mappingRows,
  type LocalMappingRecord,
  type LocalMappingRow,
  type MappingSection,
} from './qbo-mapping-model';

const SECTION_META: Record<
  MappingSection,
  {
    label: string;
    localLabel: string;
    externalLabel: string;
    externalEntities: readonly QboExternalEntityMapping['externalEntity'][];
  }
> = {
  accounts: {
    label: 'Accounts',
    localLabel: 'GL accounts',
    externalLabel: 'QBO accounts',
    externalEntities: ['Account'],
  },
  departments: {
    label: 'Departments',
    localLabel: 'Departments',
    externalLabel: 'QBO classes and locations',
    externalEntities: ['Class', 'Department'],
  },
  projects: {
    label: 'Projects',
    localLabel: 'Projects',
    externalLabel: 'QBO customers',
    externalEntities: ['Customer'],
  },
  vendors: {
    label: 'Vendors',
    localLabel: 'Vendors',
    externalLabel: 'QBO vendors',
    externalEntities: ['Vendor'],
  },
};

const SECTIONS = Object.keys(SECTION_META) as MappingSection[];

interface MappingData {
  mappings: QboExternalEntityMapping[];
  local: Record<Exclude<MappingSection, 'accounts'>, LocalMappingRecord[]>;
  qboConnected: boolean;
  qboRealmId: string | null;
  vendorsDenied: boolean;
}

function localRecord(value: unknown): LocalMappingRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  return {
    id: record.id,
    name: record.name,
    code: typeof record.code === 'string' ? record.code : null,
    active: record.status === undefined || record.status === 'active',
  };
}

function localRecords(values: unknown[]): LocalMappingRecord[] {
  return values.flatMap((value) => {
    const record = localRecord(value);
    return record ? [record] : [];
  });
}

function externalName(mapping: QboExternalEntityMapping) {
  return mapping.displayName ?? mapping.externalId;
}

function syncedLabel(mappings: QboExternalEntityMapping[]): string {
  const latest = mappings.reduce<string | null>((current, mapping) => {
    if (!mapping.syncedAt) return current;
    return !current || mapping.syncedAt > current ? mapping.syncedAt : current;
  }, null);
  if (!latest) return 'Not synced yet';
  return `Synced ${new Date(latest).toLocaleString()}`;
}

export function QboMappingWorkbench() {
  const { access, resolved: accessResolved } = useAccess();
  const canView = access?.permissions.includes('reports:view') ?? false;
  const canManage = canView && (access?.permissions.includes('reports:export') ?? false);
  const canViewVendors = access?.permissions.includes('vendors:view') ?? false;
  const [section, setSection] = useState<MappingSection>('departments');
  const [data, setData] = useState<MappingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const [oauth, mappings, departments, projects, vendors] = await Promise.all([
        api.gl.oauthStatus(),
        api.qboMappings.list(),
        api.departments.list(),
        api.projects.list(),
        canViewVendors ? api.vendors.list() : Promise.resolve([]),
      ]);
      if (requestId !== loadRequestId.current) return;
      setData({
        mappings,
        qboConnected: oauth.qbo,
        qboRealmId: oauth.qboRealmId ?? null,
        vendorsDenied: !canViewVendors,
        local: {
          departments: localRecords(departments),
          projects: localRecords(projects),
          vendors: localRecords(vendors),
        },
      });
    } catch (nextError) {
      if (requestId !== loadRequestId.current) return;
      setError(nextError);
      setData(null);
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [canViewVendors]);

  useEffect(() => {
    if (!accessResolved || !canView) {
      loadRequestId.current += 1;
      return;
    }
    void Promise.resolve().then(load);
    return () => {
      loadRequestId.current += 1;
    };
  }, [accessResolved, canView, load]);

  const mappingsBySection = useMemo(() => {
    const result = {} as Record<MappingSection, QboExternalEntityMapping[]>;
    for (const key of SECTIONS) {
      result[key] = (data?.mappings ?? []).filter((mapping) =>
        SECTION_META[key].externalEntities.includes(mapping.externalEntity),
      );
    }
    return result;
  }, [data?.mappings]);

  const rowsBySection = useMemo(() => {
    if (!data) return null;
    return {
      departments: mappingRows(data.local.departments, mappingsBySection.departments),
      projects: mappingRows(data.local.projects, mappingsBySection.projects),
      vendors: mappingRows(data.local.vendors, mappingsBySection.vendors),
    };
  }, [data, mappingsBySection]);

  const rows = section === 'accounts' ? [] : (rowsBySection?.[section] ?? []);
  const selected = rows.find((row) => row.id === selectedLocalId) ?? rows[0] ?? null;
  const sectionMappings = mappingsBySection[section] ?? [];
  const catalog = sectionMappings.filter(
    (mapping) =>
      mapping.isActive &&
      !mapping.isDeleted &&
      (!mapping.localId || mapping.localId === selected?.id) &&
      (!catalogQuery || catalogSearchText(mapping).includes(catalogQuery.toLowerCase())),
  );
  const unresolved = rows.filter((row) => !row.mapping);
  const linked = rows.filter((row) => row.mapping);
  const totalOpen = rowsBySection
    ? Object.values(rowsBySection).reduce(
        (count, sectionRows) => count + sectionRows.filter((row) => !row.mapping).length,
        0,
      )
    : 0;

  function updateMapping(updated: QboExternalEntityMapping) {
    setData((current) =>
      current
        ? {
            ...current,
            mappings: current.mappings.map((mapping) =>
              mapping.id === updated.id ? updated : mapping,
            ),
          }
        : current,
    );
  }

  async function link(mapping: QboExternalEntityMapping, local: LocalMappingRow) {
    if (!canManage || busyId || local.mapping) return;
    setBusyId(local.id);
    setNotice('');
    try {
      const updated = await api.qboMappings.link(mapping.id, { localId: local.id });
      loadRequestId.current += 1;
      setLoading(false);
      updateMapping(updated);
      setNotice(`${local.name} linked to ${externalName(mapping)}.`);
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : 'Unable to save this mapping.');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function unlink(row: LocalMappingRow) {
    if (!canManage || !row.mapping || busyId) return;
    setBusyId(row.id);
    setNotice('');
    try {
      const updated = await api.qboMappings.link(row.mapping.id, { localId: null });
      loadRequestId.current += 1;
      setLoading(false);
      updateMapping(updated);
      setNotice(`${row.name} is no longer linked.`);
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : 'Unable to unlink this mapping.');
    } finally {
      setBusyId(null);
    }
  }

  async function syncQbo() {
    if (!canManage || syncing) return;
    setSyncing(true);
    setNotice('');
    try {
      await api.qboMappings.sync(['Account', 'Vendor', 'Class', 'Department', 'Customer']);
      setNotice('QuickBooks sync queued. Refresh in a moment to see imported changes.');
    } catch (nextError) {
      setNotice(
        nextError instanceof Error ? nextError.message : 'Unable to queue a QuickBooks sync.',
      );
    } finally {
      setSyncing(false);
    }
  }

  if (accessResolved && !canView) {
    return <ListState state="denied" loadingLabel="" emptyTitle="" emptyDescription="" />;
  }
  if (loading) {
    return (
      <ListState
        state="loading"
        loadingLabel="Loading QuickBooks mappings..."
        emptyTitle=""
        emptyDescription=""
      />
    );
  }
  if (!data) {
    return (
      <ListState
        state={loadFailureState(error)}
        loadingLabel=""
        emptyTitle=""
        emptyDescription=""
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="border border-border/70 bg-black text-white">
      <header className="flex flex-col gap-5 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-7">
        <div>
          <p className="text-xs font-semibold text-primary">QuickBooks Online</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {totalOpen} mapping {totalOpen === 1 ? 'issue' : 'issues'}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-zinc-500">
            <span
              className={cn(
                'inline-flex items-center gap-2',
                data.qboConnected && 'text-emerald-400',
              )}
            >
              <span className="size-1.5 bg-current" />
              {data.qboConnected ? 'Connected' : 'Not connected'}
            </span>
            {data.qboRealmId ? <span>Realm {data.qboRealmId}</span> : null}
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5" />
              {syncedLabel(data.mappings)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          {data.qboConnected ? (
            <Button
              type="button"
              size="sm"
              disabled={!canManage || syncing}
              onClick={() => void syncQbo()}
            >
              <RefreshCw className="size-3.5" />
              {syncing ? 'Queuing...' : 'Sync QBO'}
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/addons">Connect QBO</Link>
            </Button>
          )}
        </div>
      </header>

      {notice ? (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {!canManage ? (
        <div className="border-b border-white/10 px-5 py-3 text-xs text-zinc-400">
          You have read-only access. Export permission is required to change mappings.
        </div>
      ) : null}

      <div className="grid min-h-[660px] xl:grid-cols-[190px_minmax(480px,1fr)_320px]">
        <nav
          aria-label="Mapping type"
          className="border-b border-white/10 p-3 xl:border-r xl:border-b-0"
        >
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-1">
            {SECTIONS.map((key) => {
              const count =
                key === 'accounts'
                  ? 0
                  : (rowsBySection?.[key].filter((row) => !row.mapping).length ?? 0);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSection(key);
                    setSelectedLocalId(null);
                    setCatalogQuery('');
                  }}
                  className={cn(
                    'flex h-11 items-center justify-between border-l-2 px-3 text-left text-sm',
                    section === key
                      ? 'border-primary bg-white/[0.06] text-white'
                      : 'border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-white',
                  )}
                >
                  <span>{SECTION_META[key].label}</span>
                  {key === 'accounts' ? (
                    <span className="font-mono text-[10px] text-zinc-600">CATALOG</span>
                  ) : count ? (
                    <span className="font-mono text-xs text-amber-300">{count}</span>
                  ) : (
                    <Check className="size-3.5 text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="min-w-0 border-b border-white/10 xl:border-r xl:border-b-0">
          <div className="border-b border-white/10 px-5 py-5">
            <h3 className="text-lg font-semibold">
              {SECTION_META[section].localLabel}{' '}
              <span className="font-normal text-zinc-600">to</span>{' '}
              {SECTION_META[section].externalLabel}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              {sectionMappings.filter((mapping) => mapping.isActive && !mapping.isDeleted).length}{' '}
              records synced from QuickBooks
            </p>
          </div>

          {section === 'accounts' ? (
            <AccountCatalog mappings={sectionMappings} />
          ) : data.vendorsDenied && section === 'vendors' ? (
            <ListState state="denied" loadingLabel="" emptyTitle="" emptyDescription="" />
          ) : rows.length === 0 ? (
            <ListState
              state="empty"
              loadingLabel=""
              emptyTitle={`No ${SECTION_META[section].localLabel.toLowerCase()}`}
              emptyDescription="Create local records before linking the QuickBooks catalog."
            />
          ) : (
            <MappingList
              unresolved={unresolved}
              linked={linked}
              selectedId={selected?.id ?? null}
              busyId={busyId}
              canManage={canManage}
              onSelect={setSelectedLocalId}
              onAccept={(row) => row.suggestion && void link(row.suggestion, row)}
              onUnlink={(row) => void unlink(row)}
            />
          )}
        </main>

        <aside className="p-5">
          {section === 'accounts' ? (
            <div className="text-xs leading-5 text-zinc-500">
              <h3 className="text-sm font-semibold text-white">Catalog only</h3>
              <p className="mt-3">
                BetterSpend does not yet have local GL account records to link. The synced chart of
                accounts remains available here for review.
              </p>
            </div>
          ) : selected ? (
            <CatalogPicker
              row={selected}
              mappings={catalog}
              query={catalogQuery}
              busy={busyId === selected.id}
              canManage={canManage}
              onQuery={setCatalogQuery}
              onLink={(mapping) => void link(mapping, selected)}
            />
          ) : (
            <p className="text-sm text-zinc-600">
              Select a local record to browse QuickBooks matches.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function MappingList({
  unresolved,
  linked,
  selectedId,
  busyId,
  canManage,
  onSelect,
  onAccept,
  onUnlink,
}: {
  unresolved: LocalMappingRow[];
  linked: LocalMappingRow[];
  selectedId: string | null;
  busyId: string | null;
  canManage: boolean;
  onSelect: (id: string) => void;
  onAccept: (row: LocalMappingRow) => void;
  onUnlink: (row: LocalMappingRow) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-white/10 bg-amber-400/[0.05] px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-2 text-amber-200">
          <AlertTriangle className="size-4" /> {unresolved.length} need attention
        </span>
        <span className="text-zinc-600">Review before the next export</span>
      </div>
      <section aria-labelledby="unresolved-heading">
        <h4
          id="unresolved-heading"
          className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600"
        >
          Unresolved
        </h4>
        <div className="divide-y divide-white/[0.07] border-y border-white/10">
          {unresolved.length === 0 ? (
            <p className="px-5 py-5 text-sm text-zinc-500">Everything in this section is linked.</p>
          ) : (
            unresolved.map((row) => (
              <div
                key={row.id}
                className={cn(
                  'grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
                  selectedId === row.id ? 'bg-white/[0.055]' : 'hover:bg-white/[0.025]',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  className="grid min-w-0 gap-3 py-1 text-left md:grid-cols-2 md:items-center"
                >
                  <LocalRecordLabel row={row} />
                  <span className="text-xs text-zinc-500">
                    {row.suggestion ? (
                      <>
                        <span className="block text-zinc-300">{externalName(row.suggestion)}</span>
                        <span className="mt-1 block">Suggested match</span>
                      </>
                    ) : (
                      'No close match found'
                    )}
                  </span>
                </button>
                {row.suggestion ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canManage || busyId !== null}
                    onClick={() => onAccept(row)}
                  >
                    <Link2 className="size-3.5" /> {busyId === row.id ? 'Linking...' : 'Accept'}
                  </Button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className="text-left text-xs font-semibold text-primary"
                  >
                    Choose match
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="linked-heading" className="mt-7">
        <div className="flex items-center justify-between px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
          <h4 id="linked-heading">Linked</h4>
          <span>{linked.length}</span>
        </div>
        <div className="divide-y divide-white/[0.07] border-y border-white/10">
          {linked.map((row) => (
            <div
              key={row.id}
              className={cn(
                'grid gap-3 px-5 py-2 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
                selectedId === row.id ? 'bg-white/[0.045]' : 'hover:bg-white/[0.025]',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                className="grid min-w-0 gap-3 py-1 text-left md:grid-cols-[minmax(10rem,1fr)_auto_minmax(10rem,1fr)] md:items-center"
              >
                <LocalRecordLabel row={row} />
                <ArrowRight className="hidden size-3.5 text-zinc-700 md:block" />
                <span className="text-zinc-400">
                  {row.mapping ? externalName(row.mapping) : null}
                </span>
              </button>
              <button
                type="button"
                disabled={!canManage || busyId !== null}
                className="justify-self-start text-xs text-zinc-600 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 md:justify-self-end"
                onClick={() => onUnlink(row)}
              >
                {busyId === row.id ? 'Unlinking...' : 'Unlink'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LocalRecordLabel({ row }: { row: LocalMappingRecord }) {
  return (
    <span>
      <span className="block text-sm font-medium text-white">{row.name}</span>
      <span className="mt-1 block font-mono text-xs text-zinc-600">
        {row.code ?? 'No code'}
        {row.active ? '' : ' · inactive'}
      </span>
    </span>
  );
}

function CatalogPicker({
  row,
  mappings,
  query,
  busy,
  canManage,
  onQuery,
  onLink,
}: {
  row: LocalMappingRow;
  mappings: QboExternalEntityMapping[];
  query: string;
  busy: boolean;
  canManage: boolean;
  onQuery: (value: string) => void;
  onLink: (mapping: QboExternalEntityMapping) => void;
}) {
  if (row.mapping) {
    return (
      <div>
        <h3 className="text-sm font-semibold">Current QBO link</h3>
        <div className="mt-4 border-y border-white/10 py-4">
          <p className="text-sm font-medium">{externalName(row.mapping)}</p>
          <p className="mt-1 font-mono text-xs text-zinc-600">
            {mappingCode(row.mapping) ?? `QBO ID ${row.mapping.externalId}`}
          </p>
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-500">
          Unlink this record before choosing a different QuickBooks match.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold">Choose a QBO record</h3>
      <div className="mt-4 border-y border-white/10 py-4">
        <p className="text-xs text-zinc-500">BetterSpend</p>
        <p className="mt-1 text-sm font-medium">{row.name}</p>
        <p className="mt-1 font-mono text-xs text-zinc-600">{row.code ?? 'No code'}</p>
      </div>
      <label className="relative mt-5 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search synced QBO records"
          className="border-white/15 bg-black pl-9 text-white"
        />
      </label>
      <div className="mt-3 divide-y divide-white/[0.07] border-y border-white/10">
        {mappings.length === 0 ? (
          <p className="py-5 text-xs text-zinc-600">No available QuickBooks records.</p>
        ) : (
          mappings.slice(0, 30).map((mapping) => (
            <button
              key={mapping.id}
              type="button"
              disabled={!canManage || busy || mapping.id === row.mapping?.id}
              onClick={() => onLink(mapping)}
              className="flex w-full items-center justify-between gap-3 py-3 text-left disabled:cursor-default disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-zinc-200">
                  {externalName(mapping)}
                </span>
                <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                  {mappingCode(mapping) ?? `QBO ID ${mapping.externalId}`}
                </span>
              </span>
              <span className="text-[10px] font-semibold text-primary">
                {mapping.id === row.mapping?.id ? 'Linked' : busy ? 'Saving' : 'Link'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function AccountCatalog({ mappings }: { mappings: QboExternalEntityMapping[] }) {
  const [query, setQuery] = useState('');
  const visible = mappings.filter(
    (mapping) =>
      !mapping.isDeleted && (!query || catalogSearchText(mapping).includes(query.toLowerCase())),
  );
  return (
    <div>
      <div className="border-b border-white/10 p-4">
        <label className="relative block max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the synced chart of accounts"
            className="border-white/15 bg-black pl-9 text-white"
          />
        </label>
      </div>
      <div className="divide-y divide-white/[0.07]">
        {visible.map((mapping) => (
          <div
            key={mapping.id}
            className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[8rem_1fr_auto] sm:items-center"
          >
            <span className="font-mono text-xs text-zinc-500">
              {mappingCode(mapping) ?? 'No number'}
            </span>
            <span>{externalName(mapping)}</span>
            <span
              className={cn('text-xs', mapping.isActive ? 'text-emerald-400' : 'text-zinc-600')}
            >
              {mapping.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}
        {visible.length === 0 ? (
          <p className="px-5 py-8 text-sm text-zinc-500">No synced accounts match this search.</p>
        ) : null}
      </div>
    </div>
  );
}
