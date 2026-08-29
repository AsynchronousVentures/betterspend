'use client';

// Three variants of the QBO mapping workspace, switchable via `?variant=`, on the existing `/gl-mappings` route.

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Link2,
  ListFilter,
  RefreshCw,
  Search,
  Settings2,
  Unlink,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { PrototypeSwitcher, type PrototypeVariant } from './prototype-switcher';

type EntityKey = 'account' | 'class' | 'customer' | 'vendor';
type ViewKey = EntityKey | 'defaults';
type MappingState = 'linked' | 'unmapped' | 'stale';

interface MappingRow {
  id: string;
  internalCode: string;
  internalName: string;
  externalCode?: string;
  externalName?: string;
  state: MappingState;
  suggestion?: string;
  usedBy: string;
}

interface ExternalRecord {
  id: string;
  code: string;
  name: string;
  detail: string;
  active: boolean;
}

const ENTITY_META: Record<
  EntityKey,
  { internal: string; external: string; short: string; total: number; synced: number }
> = {
  account: {
    internal: 'GL accounts',
    external: 'QBO accounts',
    short: 'Accounts',
    total: 12,
    synced: 84,
  },
  class: {
    internal: 'Departments',
    external: 'QBO classes',
    short: 'Classes',
    total: 7,
    synced: 9,
  },
  customer: {
    internal: 'Projects',
    external: 'QBO customers',
    short: 'Customers',
    total: 8,
    synced: 31,
  },
  vendor: {
    internal: 'Vendors',
    external: 'QBO vendors',
    short: 'Vendors',
    total: 24,
    synced: 118,
  },
};

const MAPPINGS: Record<EntityKey, MappingRow[]> = {
  account: [
    {
      id: 'map_acc_01',
      internalCode: '6000',
      internalName: 'Office supplies',
      externalCode: '6400',
      externalName: 'Office Supplies & Software',
      state: 'linked',
      usedBy: '38 invoices',
    },
    {
      id: 'map_acc_02',
      internalCode: '6100',
      internalName: 'Software subscriptions',
      externalCode: '6350',
      externalName: 'Dues & Subscriptions',
      state: 'linked',
      usedBy: '19 invoices',
    },
    {
      id: 'map_acc_03',
      internalCode: '6200',
      internalName: 'Travel',
      state: 'unmapped',
      suggestion: 'Travel Meals',
      usedBy: '11 invoices',
    },
    {
      id: 'map_acc_04',
      internalCode: '6250',
      internalName: 'Client entertainment',
      externalCode: '6425',
      externalName: 'Meals and Entertainment',
      state: 'stale',
      usedBy: '4 invoices',
    },
    {
      id: 'map_acc_05',
      internalCode: '6300',
      internalName: 'Professional services',
      externalCode: '6500',
      externalName: 'Legal & Professional Fees',
      state: 'linked',
      usedBy: '16 invoices',
    },
    {
      id: 'map_acc_06',
      internalCode: '6600',
      internalName: 'Equipment rental',
      state: 'unmapped',
      suggestion: 'Equipment Rental',
      usedBy: '2 invoices',
    },
  ],
  class: [
    {
      id: 'map_class_01',
      internalCode: 'ENG',
      internalName: 'Engineering',
      externalCode: 'Engineering',
      externalName: 'Engineering',
      state: 'linked',
      usedBy: '42 invoices',
    },
    {
      id: 'map_class_02',
      internalCode: 'MKT',
      internalName: 'Marketing',
      externalCode: 'Growth',
      externalName: 'Growth',
      state: 'linked',
      usedBy: '25 invoices',
    },
    {
      id: 'map_class_03',
      internalCode: 'OPS',
      internalName: 'Operations',
      state: 'unmapped',
      suggestion: 'Operations',
      usedBy: '14 invoices',
    },
    {
      id: 'map_class_04',
      internalCode: 'PEO',
      internalName: 'People',
      state: 'unmapped',
      usedBy: '7 invoices',
    },
  ],
  customer: [
    {
      id: 'map_customer_01',
      internalCode: 'PRJ-104',
      internalName: 'Phoenix rollout',
      externalCode: 'Acme:Phoenix',
      externalName: 'Acme Corp: Phoenix',
      state: 'linked',
      usedBy: '21 invoices',
    },
    {
      id: 'map_customer_02',
      internalCode: 'PRJ-112',
      internalName: 'HQ expansion',
      externalCode: 'Internal:HQ',
      externalName: 'Internal: HQ Expansion',
      state: 'linked',
      usedBy: '13 invoices',
    },
    {
      id: 'map_customer_03',
      internalCode: 'PRJ-118',
      internalName: 'Fleet refresh',
      state: 'unmapped',
      suggestion: 'Internal: Fleet 2026',
      usedBy: '6 invoices',
    },
  ],
  vendor: [
    {
      id: 'map_vendor_01',
      internalCode: 'V-0042',
      internalName: 'Figma, Inc.',
      externalCode: 'QBO-229',
      externalName: 'Figma Inc',
      state: 'linked',
      usedBy: '8 invoices',
    },
    {
      id: 'map_vendor_02',
      internalCode: 'V-0071',
      internalName: 'AWS',
      externalCode: 'QBO-051',
      externalName: 'Amazon Web Services',
      state: 'linked',
      usedBy: '27 invoices',
    },
    {
      id: 'map_vendor_03',
      internalCode: 'V-0098',
      internalName: 'Frontier Office Co.',
      state: 'unmapped',
      suggestion: 'Frontier Office Company',
      usedBy: '5 invoices',
    },
    {
      id: 'map_vendor_04',
      internalCode: 'V-0112',
      internalName: 'Mountain Air Travel',
      externalCode: 'QBO-388',
      externalName: 'Mountain Air',
      state: 'stale',
      usedBy: '3 invoices',
    },
  ],
};

const CATALOGS: Record<EntityKey, ExternalRecord[]> = {
  account: [
    {
      id: 'qbo_acc_6400',
      code: '6400',
      name: 'Office Supplies & Software',
      detail: 'Expense',
      active: true,
    },
    {
      id: 'qbo_acc_6350',
      code: '6350',
      name: 'Dues & Subscriptions',
      detail: 'Expense',
      active: true,
    },
    { id: 'qbo_acc_6410', code: '6410', name: 'Travel Meals', detail: 'Expense', active: true },
    {
      id: 'qbo_acc_6425',
      code: '6425',
      name: 'Meals and Entertainment',
      detail: 'Expense',
      active: false,
    },
    { id: 'qbo_acc_6610', code: '6610', name: 'Equipment Rental', detail: 'Expense', active: true },
  ],
  class: [
    {
      id: 'qbo_class_eng',
      code: 'Engineering',
      name: 'Engineering',
      detail: 'Class',
      active: true,
    },
    { id: 'qbo_class_growth', code: 'Growth', name: 'Growth', detail: 'Class', active: true },
    { id: 'qbo_class_ops', code: 'Operations', name: 'Operations', detail: 'Class', active: true },
    {
      id: 'qbo_class_gna',
      code: 'G&A',
      name: 'General & Administrative',
      detail: 'Class',
      active: true,
    },
  ],
  customer: [
    {
      id: 'qbo_customer_phx',
      code: 'Acme:Phoenix',
      name: 'Acme Corp: Phoenix',
      detail: 'Sub-customer',
      active: true,
    },
    {
      id: 'qbo_customer_hq',
      code: 'Internal:HQ',
      name: 'Internal: HQ Expansion',
      detail: 'Sub-customer',
      active: true,
    },
    {
      id: 'qbo_customer_fleet',
      code: 'Internal:Fleet',
      name: 'Internal: Fleet 2026',
      detail: 'Sub-customer',
      active: true,
    },
    {
      id: 'qbo_customer_legacy',
      code: 'Legacy:West',
      name: 'Legacy West Region',
      detail: 'Customer',
      active: false,
    },
  ],
  vendor: [
    { id: 'qbo_vendor_figma', code: 'QBO-229', name: 'Figma Inc', detail: 'Vendor', active: true },
    {
      id: 'qbo_vendor_aws',
      code: 'QBO-051',
      name: 'Amazon Web Services',
      detail: 'Vendor',
      active: true,
    },
    {
      id: 'qbo_vendor_frontier',
      code: 'QBO-304',
      name: 'Frontier Office Company',
      detail: 'Vendor',
      active: true,
    },
    {
      id: 'qbo_vendor_air',
      code: 'QBO-388',
      name: 'Mountain Air',
      detail: 'Vendor',
      active: false,
    },
  ],
};

const VIEWS: ViewKey[] = ['account', 'class', 'customer', 'vendor', 'defaults'];

function getUnmapped(entity: EntityKey) {
  return MAPPINGS[entity].filter((row) => row.state !== 'linked').length;
}

function viewLabel(view: ViewKey) {
  return view === 'defaults' ? 'Defaults' : ENTITY_META[view].short;
}

function stateLabel(state: MappingState) {
  if (state === 'linked') return 'Linked';
  if (state === 'stale') return 'Inactive in QBO';
  return 'Unmapped';
}

function StateMark({ state }: { state: MappingState }) {
  const tone =
    state === 'linked' ? 'text-emerald-400' : state === 'stale' ? 'text-red-400' : 'text-amber-300';
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold ${tone}`}>
      <span className="size-1.5 bg-current" />
      {stateLabel(state)}
    </span>
  );
}

function HeaderStatus({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center ${compact ? 'gap-4' : 'gap-6'} text-xs text-zinc-400`}
    >
      <span className="inline-flex items-center gap-2 text-emerald-400">
        <span className="size-1.5 bg-emerald-400" />
        Connected
      </span>
      <span>Acme Holdings · Realm 913407281</span>
      <span className="inline-flex items-center gap-1.5">
        <Clock3 className="size-3.5" />
        Synced 8 min ago
      </span>
      <span className="font-mono text-zinc-500">sync_01J94A · completed</span>
    </div>
  );
}

function SyncButton({ quiet = false }: { quiet?: boolean }) {
  return (
    <button
      type="button"
      className={
        quiet
          ? 'inline-flex h-9 items-center gap-2 border border-white/15 px-3 text-xs font-semibold text-white hover:bg-white/5'
          : 'inline-flex h-9 items-center gap-2 bg-white px-3 text-xs font-semibold text-black hover:bg-zinc-200'
      }
    >
      <RefreshCw className="size-3.5" />
      Sync QBO
    </button>
  );
}

function MappingWarning({ entity }: { entity: EntityKey }) {
  const count = getUnmapped(entity);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-xs">
      <span className="flex items-center gap-2 text-amber-200">
        <AlertTriangle className="size-4" />
        {count} {ENTITY_META[entity].internal.toLowerCase()} need attention before the next export.
      </span>
      <span className="text-zinc-500">
        Unmapped values fall back to workspace defaults when configured.
      </span>
    </div>
  );
}

function DefaultsTable({ minimal = false }: { minimal?: boolean }) {
  const defaults = [
    { label: 'Uncategorized expense', value: '6999 · Uncategorized Expense', status: 'set' },
    { label: 'Department class', value: 'No default', status: 'missing' },
    { label: 'Project customer', value: 'Internal · Unassigned', status: 'set' },
    { label: 'Vendor behavior', value: 'Block export if unmapped', status: 'set' },
  ];
  return (
    <div className={minimal ? '' : 'border border-white/10'}>
      {defaults.map((item, index) => (
        <div
          key={item.label}
          className={`grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.4fr)_auto] md:items-center ${
            index > 0 ? 'border-t border-white/10' : ''
          }`}
        >
          <span className="font-medium text-white">{item.label}</span>
          <span className={item.status === 'missing' ? 'text-amber-300' : 'text-zinc-400'}>
            {item.value}
          </span>
          <button
            type="button"
            className="justify-self-start text-xs font-semibold text-orange-400 hover:text-orange-300 md:justify-self-end"
          >
            Change
          </button>
        </div>
      ))}
    </div>
  );
}

function VariantA() {
  const [view, setView] = useState<ViewKey>('account');
  const [selectedId, setSelectedId] = useState(MAPPINGS.account[2].id);
  const entity = view === 'defaults' ? null : view;
  const rows = entity ? MAPPINGS[entity] : [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];

  function selectView(nextView: ViewKey) {
    setView(nextView);
    if (nextView !== 'defaults') setSelectedId(MAPPINGS[nextView][0].id);
  }

  return (
    <main className="min-h-screen bg-black pb-28 text-white">
      <header className="border-b border-white/10 px-5 py-5 lg:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">
              Integrations / QuickBooks Online
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Mapping workbench</h1>
            <div className="mt-3">
              <HeaderStatus />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="h-9 border border-white/15 px-3 text-xs font-semibold text-zinc-300 hover:bg-white/5"
            >
              Export history
            </button>
            <SyncButton />
          </div>
        </div>
      </header>

      <div className="grid min-h-[720px] xl:grid-cols-[210px_minmax(540px,1fr)_310px]">
        <nav className="border-b border-white/10 px-3 py-5 xl:border-r xl:border-b-0">
          <div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Mapping type
          </div>
          <div className="grid gap-1 sm:grid-cols-5 xl:grid-cols-1">
            {VIEWS.map((item) => {
              const active = item === view;
              const attention = item === 'defaults' ? 1 : getUnmapped(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => selectView(item)}
                  className={`flex h-11 items-center justify-between border-l-2 px-3 text-left text-sm ${
                    active
                      ? 'border-orange-400 bg-white/[0.06] text-white'
                      : 'border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-white'
                  }`}
                >
                  <span>{viewLabel(item)}</span>
                  <span
                    className={
                      attention
                        ? 'font-mono text-xs text-amber-300'
                        : 'font-mono text-xs text-zinc-600'
                    }
                  >
                    {attention}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 border-t border-white/10 px-3 pt-4 text-xs leading-5 text-zinc-500">
            <div className="flex justify-between">
              <span>Mapped</span>
              <span className="font-mono text-zinc-300">43</span>
            </div>
            <div className="flex justify-between">
              <span>Needs attention</span>
              <span className="font-mono text-amber-300">9</span>
            </div>
            <div className="flex justify-between">
              <span>QBO records</span>
              <span className="font-mono text-zinc-300">242</span>
            </div>
          </div>
        </nav>

        <section className="min-w-0 border-b border-white/10 xl:border-r xl:border-b-0">
          {entity ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    {ENTITY_META[entity].internal}{' '}
                    <span className="font-normal text-zinc-600">to</span>{' '}
                    {ENTITY_META[entity].external}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {ENTITY_META[entity].total} internal · {ENTITY_META[entity].synced} synced from
                    QBO
                  </p>
                </div>
                <label className="flex h-9 w-64 items-center gap-2 border border-white/15 bg-zinc-950 px-3 text-zinc-500">
                  <Search className="size-3.5" />
                  <input
                    className="w-full bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
                    placeholder={`Search ${ENTITY_META[entity].internal.toLowerCase()}`}
                  />
                </label>
              </div>
              <MappingWarning entity={entity} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.12em] text-zinc-600">
                    <tr>
                      <th className="px-5 py-3 font-semibold">BetterSpend</th>
                      <th className="px-5 py-3 font-semibold">QuickBooks Online</th>
                      <th className="px-5 py-3 font-semibold">State</th>
                      <th className="px-5 py-3 text-right font-semibold">Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedId(row.id)}
                        className={`cursor-pointer border-b border-white/[0.07] ${selected?.id === row.id ? 'bg-white/[0.055]' : 'hover:bg-white/[0.025]'}`}
                      >
                        <td className="px-5 py-4">
                          <div className="font-medium text-white">{row.internalName}</div>
                          <div className="mt-1 font-mono text-xs text-zinc-500">
                            {row.internalCode}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {row.externalName ? (
                            <>
                              <div
                                className={
                                  row.state === 'stale'
                                    ? 'text-zinc-500 line-through'
                                    : 'text-zinc-200'
                                }
                              >
                                {row.externalName}
                              </div>
                              <div className="mt-1 font-mono text-xs text-zinc-600">
                                {row.externalCode}
                              </div>
                            </>
                          ) : (
                            <span className="text-zinc-600">Select a QBO record</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <StateMark state={row.state} />
                        </td>
                        <td className="px-5 py-4 text-right text-xs text-zinc-500">{row.usedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-5 lg:p-7">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Export defaults</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Fallbacks apply only where exports allow unmapped values.
                </p>
              </div>
              <div className="mb-4 flex items-center gap-2 border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200">
                <CircleAlert className="size-4" /> Department class has no default. Invoices without
                a mapped department will be blocked.
              </div>
              <DefaultsTable />
            </div>
          )}
        </section>

        <aside className="px-5 py-5">
          {entity && selected ? (
            <>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {selected.state === 'unmapped' ? 'Choose a QBO record' : 'Mapping detail'}
                </h2>
                <span className="font-mono text-[10px] text-zinc-600">{selected.id}</span>
              </div>
              <div className="border-y border-white/10 py-4">
                <div className="text-xs text-zinc-500">BetterSpend</div>
                <div className="mt-1 text-sm font-medium">{selected.internalName}</div>
                <div className="mt-1 font-mono text-xs text-zinc-500">{selected.internalCode}</div>
              </div>
              <label className="mt-5 flex h-9 items-center gap-2 border border-white/15 px-3 text-zinc-600">
                <Search className="size-3.5" />
                <input
                  className="w-full bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
                  placeholder={`Search ${ENTITY_META[entity].external.toLowerCase()}`}
                />
              </label>
              <div className="mt-3 divide-y divide-white/[0.07] border-y border-white/10">
                {CATALOGS[entity].slice(0, 4).map((record, index) => (
                  <button
                    key={record.id}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 py-3 text-left ${!record.active ? 'opacity-45' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-zinc-200">
                        {record.name}
                      </span>
                      <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                        {record.code} · {record.detail}
                      </span>
                    </span>
                    {index === 0 && selected.state === 'unmapped' ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-400">
                        Suggested
                      </span>
                    ) : (
                      <ChevronRight className="size-3.5 text-zinc-700" />
                    )}
                  </button>
                ))}
              </div>
              {selected.state !== 'unmapped' ? (
                <button
                  type="button"
                  className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 border border-red-400/30 text-xs font-semibold text-red-300 hover:bg-red-400/10"
                >
                  <Unlink className="size-3.5" /> Unlink mapping
                </button>
              ) : (
                <button
                  type="button"
                  className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 bg-white text-xs font-semibold text-black hover:bg-zinc-200"
                >
                  <Link2 className="size-3.5" /> Link selected
                </button>
              )}
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold">Default policy</h2>
              <div className="mt-5 space-y-5 text-xs leading-5 text-zinc-500">
                <p>
                  Defaults are stored per external entity type and used only when the export policy
                  permits a fallback.
                </p>
                <p>
                  Vendor mapping remains strict. An unmapped vendor blocks export even when other
                  defaults are set.
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function VariantB() {
  const [view, setView] = useState<ViewKey>('account');
  const [expandedId, setExpandedId] = useState<string | null>(MAPPINGS.account[2].id);
  const entity = view === 'defaults' ? null : view;
  const rows = entity ? MAPPINGS[entity] : [];
  const unresolved = rows.filter((row) => row.state !== 'linked');
  const linked = rows.filter((row) => row.state === 'linked');

  return (
    <main className="min-h-screen bg-black pb-28 text-white">
      <header className="px-5 pt-6 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-semibold text-orange-400">QuickBooks Online</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">9 mapping issues</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Clear exceptions before the next invoice export.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 xl:items-end">
            <SyncButton quiet />
            <HeaderStatus compact />
          </div>
        </div>
        <div className="mt-7 flex overflow-x-auto border-b border-white/10">
          {VIEWS.map((item) => {
            const count = item === 'defaults' ? 1 : getUnmapped(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={`relative flex h-11 items-center gap-2 px-4 text-xs font-semibold ${view === item ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {viewLabel(item)}
                {count > 0 ? (
                  <span className="font-mono text-amber-300">{count}</span>
                ) : (
                  <Check className="size-3.5 text-emerald-400" />
                )}
                {view === item ? (
                  <span className="absolute inset-x-4 bottom-0 h-0.5 bg-orange-400" />
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      {entity ? (
        <div className="px-5 py-6 lg:px-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6 text-xs">
              <span className="text-zinc-500">
                <strong className="mr-2 text-xl font-semibold text-white">
                  {unresolved.length}
                </strong>
                Open
              </span>
              <span className="text-zinc-500">
                <strong className="mr-2 text-xl font-semibold text-white">{linked.length}</strong>
                Linked
              </span>
              <span className="text-zinc-500">
                <strong className="mr-2 text-xl font-semibold text-white">
                  {ENTITY_META[entity].synced}
                </strong>
                In QBO
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 border border-white/15 px-3 text-xs text-zinc-300"
              >
                <ListFilter className="size-3.5" /> Highest usage
              </button>
              <label className="flex h-9 w-56 items-center gap-2 border border-white/15 px-3 text-zinc-600">
                <Search className="size-3.5" />
                <input
                  className="w-full bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
                  placeholder="Search issues"
                />
              </label>
            </div>
          </div>

          <section className="border-t border-white/10">
            <div className="flex items-center justify-between py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              <span>Needs attention</span>
              <span>{ENTITY_META[entity].internal} by export usage</span>
            </div>
            {unresolved.map((row) => {
              const expanded = expandedId === row.id;
              const candidates = CATALOGS[entity].filter((record) => record.active).slice(0, 3);
              return (
                <article
                  key={row.id}
                  className={`border-t border-white/10 ${expanded ? 'bg-zinc-950' : ''}`}
                >
                  <button
                    type="button"
                    className="grid w-full gap-3 px-4 py-4 text-left md:grid-cols-[minmax(14rem,1fr)_minmax(10rem,0.7fr)_auto] md:items-center"
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                  >
                    <span>
                      <span className="block text-sm font-medium text-white">
                        {row.internalName}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-zinc-600">
                        {row.internalCode} · {row.usedBy}
                      </span>
                    </span>
                    <StateMark state={row.state} />
                    <span className="flex items-center gap-2 text-xs font-semibold text-orange-400">
                      Resolve <ChevronRight className={`size-4 ${expanded ? 'rotate-90' : ''}`} />
                    </span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-white/[0.07] px-4 py-4 md:pl-[calc(25%+1rem)]">
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                        Suggested QBO matches
                      </div>
                      <div className="grid gap-px bg-white/10 lg:grid-cols-3">
                        {candidates.map((record, index) => (
                          <button
                            key={record.id}
                            type="button"
                            className="bg-black p-4 text-left hover:bg-white/[0.04]"
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="text-xs font-medium text-zinc-200">
                                {record.name}
                              </span>
                              {index === 0 ? (
                                <span className="text-[10px] font-semibold text-orange-400">
                                  92%
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-2 block font-mono text-[10px] text-zinc-600">
                              {record.code} · {record.detail}
                            </span>
                            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                              <Link2 className="size-3" /> Link
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>

          <section className="mt-8 border-t border-white/10">
            <div className="flex items-center justify-between py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              <span>Linked</span>
              <span>{linked.length} shown</span>
            </div>
            <div className="divide-y divide-white/[0.07] border-y border-white/10">
              {linked.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(12rem,1fr)_auto_minmax(12rem,1fr)_auto] md:items-center"
                >
                  <span>
                    <span className="font-medium text-white">{row.internalName}</span>
                    <span className="ml-2 font-mono text-xs text-zinc-600">{row.internalCode}</span>
                  </span>
                  <ArrowRight className="hidden size-3.5 text-zinc-700 md:block" />
                  <span className="text-zinc-400">
                    {row.externalName}
                    <span className="ml-2 font-mono text-xs text-zinc-600">{row.externalCode}</span>
                  </span>
                  <button
                    type="button"
                    className="justify-self-start text-xs text-zinc-600 hover:text-red-300 md:justify-self-end"
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-8 px-5 py-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
          <section>
            <div className="mb-5 flex items-center gap-3 text-amber-200">
              <AlertTriangle className="size-5" />
              <h2 className="text-lg font-semibold">1 default needs attention</h2>
            </div>
            <DefaultsTable />
          </section>
          <aside className="border-l border-white/10 pl-6">
            <h3 className="text-sm font-semibold">Export policy</h3>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Block vendor exports. Allow account, department, and project fallbacks when a default
              exists.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}

function VariantC() {
  const [view, setView] = useState<ViewKey>('account');
  const [internalId, setInternalId] = useState(MAPPINGS.account[2].id);
  const [externalId, setExternalId] = useState(CATALOGS.account[2].id);
  const entity = view === 'defaults' ? null : view;
  const rows = entity ? MAPPINGS[entity] : [];
  const catalog = entity ? CATALOGS[entity] : [];
  const internal = rows.find((row) => row.id === internalId) ?? rows[0];
  const external = catalog.find((row) => row.id === externalId) ?? catalog[0];

  function selectView(nextView: ViewKey) {
    setView(nextView);
    if (nextView !== 'defaults') {
      setInternalId(MAPPINGS[nextView][0].id);
      setExternalId(CATALOGS[nextView][0].id);
    }
  }

  return (
    <main className="min-h-screen bg-black pb-28 text-white">
      <header className="border-b border-white/10 px-5 py-5 lg:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <h1 className="text-xl font-semibold">QBO catalog matcher</h1>
            <HeaderStatus compact />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 border border-white/15 px-3 text-xs font-semibold text-zinc-400"
            >
              Defaults
            </button>
            <SyncButton />
          </div>
        </div>
      </header>
      <div className="flex overflow-x-auto border-b border-white/10 px-5 lg:px-8">
        {VIEWS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => selectView(item)}
            className={`h-12 border-r border-white/10 px-5 text-xs font-semibold first:border-l ${view === item ? 'bg-white text-black' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-white'}`}
          >
            {viewLabel(item)} {item === 'defaults' ? '' : `(${getUnmapped(item)})`}
          </button>
        ))}
      </div>

      {entity && internal && external ? (
        <>
          <MappingWarning entity={entity} />
          <div className="grid min-h-[560px] lg:grid-cols-[minmax(280px,1fr)_230px_minmax(300px,1fr)]">
            <section className="border-b border-white/10 lg:border-r lg:border-b-0">
              <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
                <div>
                  <div className="text-sm font-semibold">BetterSpend</div>
                  <div className="mt-1 text-[10px] text-zinc-600">
                    {ENTITY_META[entity].internal}
                  </div>
                </div>
                <span className="font-mono text-xs text-zinc-500">{ENTITY_META[entity].total}</span>
              </div>
              <div className="border-b border-white/10 p-3">
                <label className="flex h-9 items-center gap-2 border border-white/15 px-3 text-zinc-600">
                  <Search className="size-3.5" />
                  <input
                    className="w-full bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
                    placeholder="Filter internal records"
                  />
                </label>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setInternalId(row.id)}
                    className={`flex w-full items-center justify-between gap-4 border-l-2 px-4 py-3 text-left ${internal.id === row.id ? 'border-orange-400 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.025]'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.internalName}</span>
                      <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                        {row.internalCode} · {row.usedBy}
                      </span>
                    </span>
                    <StateMark state={row.state} />
                  </button>
                ))}
              </div>
            </section>

            <section className="flex flex-col items-center justify-center border-b border-white/10 px-5 py-8 text-center lg:border-r lg:border-b-0">
              <div className="grid size-11 place-items-center border border-white/15 bg-zinc-950">
                <Link2 className="size-4 text-orange-400" />
              </div>
              <div className="mt-5 w-full min-w-0 border-y border-white/10 py-4">
                <div className="truncate text-sm font-medium">{internal.internalName}</div>
                <ArrowRight className="mx-auto my-3 size-4 text-zinc-700" />
                <div className="truncate text-sm font-medium">{external.name}</div>
              </div>
              {!external.active ? (
                <div className="mt-4 text-xs leading-5 text-red-300">
                  This QBO record is inactive and cannot receive new links.
                </div>
              ) : null}
              <button
                type="button"
                disabled={!external.active}
                className="mt-5 h-10 w-full bg-white text-xs font-semibold text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                Link records
              </button>
              {internal.state !== 'unmapped' ? (
                <button
                  type="button"
                  className="mt-2 h-9 w-full text-xs text-red-300 hover:bg-red-400/10"
                >
                  Replace existing link
                </button>
              ) : null}
              <div className="mt-5 text-[10px] leading-4 text-zinc-600">
                Preview only. This prototype does not call PATCH.
              </div>
            </section>

            <section>
              <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
                <div>
                  <div className="text-sm font-semibold">QuickBooks Online</div>
                  <div className="mt-1 text-[10px] text-zinc-600">
                    {ENTITY_META[entity].external}
                  </div>
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {ENTITY_META[entity].synced}
                </span>
              </div>
              <div className="border-b border-white/10 p-3">
                <label className="flex h-9 items-center gap-2 border border-white/15 px-3 text-zinc-600">
                  <Search className="size-3.5" />
                  <input
                    className="w-full bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
                    placeholder="Search synced QBO catalog"
                  />
                </label>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {catalog.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setExternalId(record.id)}
                    className={`flex w-full items-center justify-between gap-4 border-r-2 px-4 py-3 text-left ${external.id === record.id ? 'border-orange-400 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.025]'}`}
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm font-medium ${record.active ? 'text-white' : 'text-zinc-600 line-through'}`}
                      >
                        {record.name}
                      </span>
                      <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                        {record.code} · {record.detail}
                      </span>
                    </span>
                    <span
                      className={`text-[10px] font-semibold ${record.active ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {record.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
          <section className="border-t border-white/10 px-5 py-5 lg:px-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Current links</h2>
              <button type="button" className="text-xs text-zinc-500 hover:text-white">
                View all {ENTITY_META[entity].short.toLowerCase()}
              </button>
            </div>
            <div className="grid gap-px bg-white/10 md:grid-cols-3">
              {rows
                .filter((row) => row.externalName)
                .slice(0, 3)
                .map((row) => (
                  <div key={row.id} className="flex items-center gap-3 bg-black px-4 py-3 text-xs">
                    <span className="min-w-0 flex-1 truncate text-zinc-300">
                      {row.internalName}
                    </span>
                    <ArrowRight className="size-3 text-zinc-700" />
                    <span className="min-w-0 flex-1 truncate text-zinc-500">
                      {row.externalName}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        </>
      ) : (
        <div className="grid min-h-[640px] lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border-b border-white/10 px-5 py-6 lg:border-r lg:border-b-0">
            <Settings2 className="size-5 text-orange-400" />
            <h2 className="mt-4 text-lg font-semibold">Export defaults</h2>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Fallback values for unmapped accounts, departments, and projects.
            </p>
          </aside>
          <section className="p-5 lg:p-8">
            <div className="mb-5 flex items-center gap-2 text-xs text-amber-200">
              <AlertTriangle className="size-4" /> Department class is required but has no default.
            </div>
            <DefaultsTable />
          </section>
        </div>
      )}
    </main>
  );
}

export function QboMappingPrototype() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('variant')?.toLowerCase();
  const variant: PrototypeVariant = requested === 'b' || requested === 'c' ? requested : 'a';

  return (
    <>
      {variant === 'a' ? <VariantA /> : null}
      {variant === 'b' ? <VariantB /> : null}
      {variant === 'c' ? <VariantC /> : null}
      <PrototypeSwitcher current={variant} />
    </>
  );
}
