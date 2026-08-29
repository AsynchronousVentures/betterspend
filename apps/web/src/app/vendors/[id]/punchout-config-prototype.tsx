'use client';

// Three variants of per-supplier PunchOut configuration, switchable via ?variant=,
// on the existing /vendors/[id] route. PROTOTYPE: no API calls or persistence.

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LockKeyhole,
  Play,
  RotateCcw,
  Save,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import { PrototypeSwitcher } from '../../../components/prototype-switcher';

type EnvironmentKey = 'test' | 'production';
type EnvironmentConfig = {
  label: string;
  setupUrl: string;
  orderUrl: string;
  fromDomain: string;
  fromIdentity: string;
  toDomain: string;
  toIdentity: string;
  senderIdentity: string;
  secret: string;
  status: 'verified' | 'auth_failed';
  lastChecked: string;
};

type PrototypeState = {
  enabled: boolean;
  activeEnvironment: EnvironmentKey;
  dialect: 'cXML 1.2';
  environments: Record<EnvironmentKey, EnvironmentConfig>;
};

const variants = [
  { key: 'control-room', name: 'Control room' },
  { key: 'matrix', name: 'Environment matrix' },
  { key: 'guided', name: 'Guided setup' },
] as const;

const initialState: PrototypeState = {
  enabled: false,
  activeEnvironment: 'test',
  dialect: 'cXML 1.2',
  environments: {
    test: {
      label: 'Test',
      setupUrl: 'https://test.punchout.northstar.example/setup',
      orderUrl: 'https://test.punchout.northstar.example/orders',
      fromDomain: 'NetworkID',
      fromIdentity: 'betterspend-test',
      toDomain: 'DUNS',
      toIdentity: '006921617',
      senderIdentity: 'betterspend-test',
      secret: '••••••••••••3k9a',
      status: 'verified',
      lastChecked: 'Aug 29, 2026 at 9:42 AM',
    },
    production: {
      label: 'Production',
      setupUrl: 'https://punchout.northstar.example/setup',
      orderUrl: 'https://punchout.northstar.example/orders',
      fromDomain: 'NetworkID',
      fromIdentity: 'betterspend',
      toDomain: 'DUNS',
      toIdentity: '006921617',
      senderIdentity: 'betterspend',
      secret: '••••••••••••91df',
      status: 'auth_failed',
      lastChecked: 'Aug 29, 2026 at 8:17 AM',
    },
  },
};

const fieldClass =
  'h-9 w-full border border-white/20 bg-black px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/70 disabled:cursor-not-allowed disabled:text-white/45';
const labelClass = 'mb-1.5 block text-xs font-medium text-white/65';
const secondaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 border border-white/25 bg-black px-3 text-xs font-semibold text-white hover:border-white/60 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-40';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 bg-white px-3 text-xs font-semibold text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40';

function StatusMark({ status }: { status: EnvironmentConfig['status'] }) {
  return status === 'verified' ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
      <Check className="size-3.5" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400">
      <CircleSlash className="size-3.5" /> Authentication failed
    </span>
  );
}

function ModeStrip() {
  return (
    <div className="flex items-center justify-between gap-4 border-y border-amber-400/45 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
      <span className="font-semibold uppercase tracking-[0.16em]">Test mode active</span>
      <span>New sessions use test credentials. Production ordering is off.</span>
    </div>
  );
}

function FailureNotice({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="grid gap-4 border-b border-red-500/40 bg-red-500/10 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
        <div>
          <div className="text-sm font-semibold text-red-200">PunchOut disabled automatically</div>
          <div className="mt-0.5 text-xs text-red-200/70">
            Production credentials were rejected three times. Configuration was retained.
          </div>
        </div>
      </div>
      <button type="button" onClick={onAcknowledge} className={secondaryButtonClass}>
        Review failure
      </button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`grid h-7 grid-cols-2 border text-[10px] font-bold uppercase ${
        checked ? 'border-emerald-400 text-emerald-300' : 'border-white/25 text-white/55'
      }`}
    >
      <span
        className={`grid w-12 place-items-center ${checked ? 'bg-emerald-400 text-black' : ''}`}
      >
        On
      </span>
      <span className={`grid w-12 place-items-center ${checked ? '' : 'bg-white text-black'}`}>
        Off
      </span>
    </button>
  );
}

function TextField({
  label,
  value,
  mono = false,
  type = 'text',
}: {
  label: string;
  value: string;
  mono?: boolean;
  type?: 'text' | 'password';
}) {
  const [currentValue, setCurrentValue] = useState(value);
  return (
    <label>
      <span className={labelClass}>{label}</span>
      <input
        type={type}
        value={currentValue}
        onChange={(event) => setCurrentValue(event.target.value)}
        className={`${fieldClass} ${mono ? 'font-mono text-xs' : ''}`}
      />
    </label>
  );
}

function SecretField({ value, compact = false }: { value: string; compact?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label>
      <span className={compact ? 'sr-only' : labelClass}>Shared secret</span>
      <span className="flex">
        <input
          readOnly
          aria-label="Masked shared secret"
          value={revealed ? 'prototype-secret-not-real' : value}
          className={`${fieldClass} border-r-0 font-mono text-xs ${compact ? 'min-w-0' : ''}`}
        />
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          className="grid size-9 shrink-0 place-items-center border border-white/20 text-white/60 hover:text-white"
          aria-label={revealed ? 'Mask secret' : 'Reveal secret'}
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
    </label>
  );
}

function EnvironmentFields({ config }: { config: EnvironmentConfig }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <TextField label="PunchOut setup URL" value={config.setupUrl} mono />
        <TextField label="PO order URL" value={config.orderUrl} mono />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TextField label="From domain" value={config.fromDomain} />
        <TextField label="From identity" value={config.fromIdentity} mono />
        <TextField label="To domain" value={config.toDomain} />
        <TextField label="To identity" value={config.toIdentity} mono />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Sender identity" value={config.senderIdentity} mono />
        <SecretField value={config.secret} />
      </div>
    </div>
  );
}

function PrototypeHeader({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <header className="border-b border-white/15 px-4 py-5 lg:px-7">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-white/45">
        <span>Suppliers</span>
        <ChevronRight className="size-3" />
        <span>Northstar Office Supply</span>
        <ChevronRight className="size-3" />
        <span className="text-white">PunchOut</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.035em] text-white">cXML PunchOut</h1>
            <span className="border border-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
              Prototype
            </span>
          </div>
          <p className="mt-1 text-sm text-white/50">Northstar Office Supply · SUP-0042</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/55">Connection</span>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      </div>
    </header>
  );
}

function VariantControlRoom({
  state,
  setState,
  notify,
}: {
  state: PrototypeState;
  setState: React.Dispatch<React.SetStateAction<PrototypeState>>;
  notify: (message: string) => void;
}) {
  const selected = state.environments[state.activeEnvironment];
  return (
    <>
      <ModeStrip />
      <FailureNotice onAcknowledge={() => notify('Opened production authentication failure.')} />
      <div className="grid min-h-[650px] lg:grid-cols-[minmax(0,1fr)_310px]">
        <main className="border-white/15 p-4 lg:border-r lg:p-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/15 pb-4">
            <div className="flex gap-1">
              {(['test', 'production'] as const).map((environment) => (
                <button
                  key={environment}
                  type="button"
                  onClick={() =>
                    setState((current) => ({ ...current, activeEnvironment: environment }))
                  }
                  className={`h-9 border px-4 text-xs font-semibold capitalize ${
                    environment === state.activeEnvironment
                      ? 'border-white bg-white text-black'
                      : 'border-white/20 text-white/60 hover:text-white'
                  }`}
                >
                  {environment}
                </button>
              ))}
            </div>
            <StatusMark status={selected.status} />
          </div>

          <div className="mb-7 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Dialect</span>
              <select className={fieldClass} defaultValue="cxml">
                <option value="cxml">cXML 1.2</option>
              </select>
            </label>
            <label>
              <span className={labelClass}>Sessions use</span>
              <select className={fieldClass} defaultValue="test">
                <option value="test">Test credentials</option>
                <option value="production">Production credentials</option>
              </select>
            </label>
          </div>

          <EnvironmentFields key={state.activeEnvironment} config={selected} />

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-5">
            <button
              type="button"
              onClick={() => notify('Connection test queued locally.')}
              className={secondaryButtonClass}
            >
              <Play className="size-3.5" /> Test {selected.label}
            </button>
            <button
              type="button"
              onClick={() => notify('Draft saved in memory only.')}
              className={primaryButtonClass}
            >
              <Save className="size-3.5" /> Save draft
            </button>
          </div>
        </main>

        <aside className="p-4 lg:p-6">
          <h2 className="text-sm font-semibold text-white">Connection state</h2>
          <div className="mt-4 divide-y divide-white/15 border-y border-white/15">
            {(['test', 'production'] as const).map((environment) => {
              const config = state.environments[environment];
              return (
                <div key={environment} className="py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{config.label}</span>
                    <StatusMark status={config.status} />
                  </div>
                  <div className="text-[11px] text-white/45">Checked {config.lastChecked}</div>
                </div>
              );
            })}
          </div>
          <h2 className="mt-7 text-sm font-semibold text-white">Failure policy</h2>
          <div className="mt-3 space-y-3 text-xs leading-5 text-white/55">
            <p>Disable after 3 authentication failures.</p>
            <p>Keep URLs, identities, and encrypted secrets.</p>
            <p>Notify supplier admins and finance.</p>
          </div>
          <button
            type="button"
            onClick={() => notify('Copied cart return URL.')}
            className={`${secondaryButtonClass} mt-6 w-full`}
          >
            <Copy className="size-3.5" /> Copy cart return URL
          </button>
        </aside>
      </div>
    </>
  );
}

function MatrixField({
  label,
  test,
  production,
  secret = false,
}: {
  label: string;
  test: string;
  production: string;
  secret?: boolean;
}) {
  return (
    <div className="grid border-b border-white/12 md:grid-cols-[170px_1fr_1fr]">
      <div className="px-3 py-3 text-xs font-medium text-white/55">{label}</div>
      <div className="border-white/12 px-3 py-2 md:border-l">
        {secret ? (
          <SecretField value={test} compact />
        ) : (
          <input defaultValue={test} className={`${fieldClass} font-mono text-xs`} />
        )}
      </div>
      <div className="border-white/12 px-3 py-2 md:border-l">
        {secret ? (
          <SecretField value={production} compact />
        ) : (
          <input defaultValue={production} className={`${fieldClass} font-mono text-xs`} />
        )}
      </div>
    </div>
  );
}

function VariantMatrix({
  state,
  notify,
}: {
  state: PrototypeState;
  notify: (message: string) => void;
}) {
  const test = state.environments.test;
  const production = state.environments.production;
  return (
    <>
      <div className="grid border-b border-white/15 lg:grid-cols-[1fr_1fr]">
        <div className="border-white/15 bg-amber-400/10 px-5 py-4 lg:border-r">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
            Live session source
          </div>
          <div className="mt-1 text-lg font-semibold text-white">Test credentials</div>
        </div>
        <div className="bg-red-500/10 px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-300">
            <AlertTriangle className="size-3.5" /> Connection disabled
          </div>
          <div className="mt-1 text-sm text-red-100/70">
            Production authentication failed. Values retained.
          </div>
        </div>
      </div>

      <main className="p-4 lg:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Credentials by environment</h2>
            <p className="mt-1 text-xs text-white/45">
              Compare before promotion. Nothing copies automatically.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => notify('Production values replaced with test values in memory.')}
              className={secondaryButtonClass}
            >
              <RotateCcw className="size-3.5" /> Copy test to production
            </button>
            <button
              type="button"
              onClick={() => notify('Matrix saved in memory only.')}
              className={primaryButtonClass}
            >
              <Save className="size-3.5" /> Save
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-white/15">
          <div className="min-w-[760px]">
            <div className="grid border-b border-white/20 bg-white/[0.04] md:grid-cols-[170px_1fr_1fr]">
              <div className="px-3 py-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                Field
              </div>
              <div className="border-l border-white/15 px-3 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">Test</span>
                  <StatusMark status={test.status} />
                </div>
              </div>
              <div className="border-l border-white/15 px-3 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">Production</span>
                  <StatusMark status={production.status} />
                </div>
              </div>
            </div>
            <MatrixField label="Setup URL" test={test.setupUrl} production={production.setupUrl} />
            <MatrixField
              label="PO order URL"
              test={test.orderUrl}
              production={production.orderUrl}
            />
            <MatrixField
              label="From domain"
              test={test.fromDomain}
              production={production.fromDomain}
            />
            <MatrixField
              label="From identity"
              test={test.fromIdentity}
              production={production.fromIdentity}
            />
            <MatrixField label="To domain" test={test.toDomain} production={production.toDomain} />
            <MatrixField
              label="To identity"
              test={test.toIdentity}
              production={production.toIdentity}
            />
            <MatrixField
              label="Sender identity"
              test={test.senderIdentity}
              production={production.senderIdentity}
            />
            <MatrixField
              label="Shared secret"
              test={test.secret}
              production={production.secret}
              secret
            />
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-white/15 pt-5 md:grid-cols-2">
          <div className="flex items-center justify-between gap-4 border-r-0 border-white/15 md:border-r md:pr-5">
            <div>
              <div className="text-xs font-semibold text-white">Test validation</div>
              <div className="mt-1 text-[11px] text-white/45">Last checked {test.lastChecked}</div>
            </div>
            <button
              type="button"
              onClick={() => notify('Test connection queued locally.')}
              className={secondaryButtonClass}
            >
              Test
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 md:pl-1">
            <div>
              <div className="text-xs font-semibold text-white">Production recovery</div>
              <div className="mt-1 text-[11px] text-red-300/70">Re-test before enabling</div>
            </div>
            <button
              type="button"
              onClick={() => notify('Production re-test queued locally.')}
              className={secondaryButtonClass}
            >
              Re-test
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

const guidedSteps = [
  { key: 'mode', label: 'Connection mode', detail: 'Test is active' },
  { key: 'endpoints', label: 'Endpoints', detail: '4 URLs set' },
  { key: 'identity', label: 'cXML identities', detail: '6 values set' },
  { key: 'credentials', label: 'Credentials', detail: 'Production failed' },
  { key: 'verify', label: 'Verify and enable', detail: 'Action required' },
] as const;
type GuidedStep = (typeof guidedSteps)[number]['key'];

function VariantGuided({
  state,
  setState,
  notify,
}: {
  state: PrototypeState;
  setState: React.Dispatch<React.SetStateAction<PrototypeState>>;
  notify: (message: string) => void;
}) {
  const [step, setStep] = useState<GuidedStep>('credentials');
  return (
    <div className="grid min-h-[720px] lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-white/15 bg-white/[0.025] p-4 lg:border-b-0 lg:border-r lg:p-5">
        <div className="mb-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
          Setup progress
        </div>
        <nav className="grid gap-1" aria-label="PunchOut setup steps">
          {guidedSteps.map((item, index) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStep(item.key)}
              className={`grid grid-cols-[24px_1fr] gap-3 border-l-2 px-3 py-3 text-left ${
                step === item.key
                  ? 'border-white bg-white/[0.06]'
                  : 'border-white/15 hover:border-white/50'
              }`}
            >
              <span className="font-mono text-xs text-white/40">0{index + 1}</span>
              <span>
                <span className="block text-xs font-semibold text-white">{item.label}</span>
                <span
                  className={`mt-1 block text-[11px] ${item.key === 'credentials' ? 'text-red-300' : 'text-white/40'}`}
                >
                  {item.detail}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="mt-8 border-t border-white/15 pt-5">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-white/50">Connection</span>
            <span className="font-semibold text-red-300">Disabled</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/50">Current mode</span>
            <span className="font-semibold text-amber-200">Test</span>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">
        <div className="border-b border-amber-400/40 bg-amber-400/10 px-5 py-3 text-xs text-amber-200">
          Test mode is active. Production stays unavailable until credentials pass.
        </div>
        <div className="flex-1 p-4 lg:p-8">
          <div className="mx-auto max-w-3xl">
            {step === 'mode' ? (
              <section>
                <h2 className="text-xl font-semibold text-white">Choose the session environment</h2>
                <p className="mt-2 text-sm text-white/50">
                  This changes where new shopping sessions connect.
                </p>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {(['test', 'production'] as const).map((environment) => (
                    <button
                      key={environment}
                      type="button"
                      disabled={environment === 'production'}
                      onClick={() =>
                        setState((current) => ({ ...current, activeEnvironment: environment }))
                      }
                      className={`border p-5 text-left ${
                        state.activeEnvironment === environment
                          ? 'border-amber-300 bg-amber-300/10'
                          : 'border-white/20'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <span className="block text-sm font-semibold capitalize text-white">
                        {environment}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-white/45">
                        {environment === 'test'
                          ? 'Safe supplier test account.'
                          : 'Blocked by authentication failure.'}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {step === 'endpoints' ? (
              <section>
                <h2 className="text-xl font-semibold text-white">Supplier endpoints</h2>
                <p className="mt-2 text-sm text-white/50">
                  Setup starts shopping. Order sends the approved PO.
                </p>
                <div className="mt-7 grid gap-7 md:grid-cols-2">
                  {(['test', 'production'] as const).map((environment) => (
                    <div key={environment} className="space-y-4 border-t border-white/20 pt-4">
                      <h3 className="text-sm font-semibold capitalize text-white">{environment}</h3>
                      <TextField
                        label="Setup URL"
                        value={state.environments[environment].setupUrl}
                        mono
                      />
                      <TextField
                        label="Order URL"
                        value={state.environments[environment].orderUrl}
                        mono
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {step === 'identity' ? (
              <section>
                <h2 className="text-xl font-semibold text-white">cXML identities</h2>
                <p className="mt-2 text-sm text-white/50">
                  Values must match the supplier account exactly.
                </p>
                <div className="mt-7 grid gap-7 md:grid-cols-2">
                  {(['test', 'production'] as const).map((environment) => {
                    const config = state.environments[environment];
                    return (
                      <div key={environment} className="space-y-4 border-t border-white/20 pt-4">
                        <h3 className="text-sm font-semibold capitalize text-white">
                          {environment}
                        </h3>
                        <TextField label="From identity" value={config.fromIdentity} mono />
                        <TextField label="To identity" value={config.toIdentity} mono />
                        <TextField label="Sender identity" value={config.senderIdentity} mono />
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {step === 'credentials' ? (
              <section>
                <div className="flex items-start gap-3 border-b border-red-500/35 pb-5">
                  <LockKeyhole className="mt-1 size-5 text-red-300" />
                  <div>
                    <h2 className="text-xl font-semibold text-white">
                      Replace production credentials
                    </h2>
                    <p className="mt-2 text-sm text-red-100/60">
                      The stored secret failed authentication. PunchOut was disabled, but no values
                      were deleted.
                    </p>
                  </div>
                </div>
                <div className="mt-7 grid gap-7 md:grid-cols-2">
                  {(['test', 'production'] as const).map((environment) => {
                    const config = state.environments[environment];
                    return (
                      <div key={environment} className="space-y-5 border-t border-white/20 pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold capitalize text-white">
                            {environment}
                          </h3>
                          <StatusMark status={config.status} />
                        </div>
                        <TextField label="Sender identity" value={config.senderIdentity} mono />
                        <SecretField value={config.secret} />
                        <button
                          type="button"
                          onClick={() => notify(`${config.label} connection test queued locally.`)}
                          className={`${secondaryButtonClass} w-full`}
                        >
                          <KeyRound className="size-3.5" /> Test credentials
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {step === 'verify' ? (
              <section>
                <h2 className="text-xl font-semibold text-white">Verify before enabling</h2>
                <div className="mt-7 divide-y divide-white/15 border-y border-white/15">
                  <div className="flex items-center justify-between py-4 text-sm">
                    <span>Test setup request</span>
                    <span className="text-emerald-400">Passed</span>
                  </div>
                  <div className="flex items-center justify-between py-4 text-sm">
                    <span>Test order request</span>
                    <span className="text-emerald-400">Passed</span>
                  </div>
                  <div className="flex items-center justify-between py-4 text-sm">
                    <span>Production credentials</span>
                    <span className="text-red-400">Failed</span>
                  </div>
                </div>
                <button type="button" disabled className={`${primaryButtonClass} mt-6`}>
                  Enable PunchOut
                </button>
              </section>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 bg-white/[0.025] px-5 py-4">
          <span className="text-xs text-white/45">Changes stay in this browser session.</span>
          <button
            type="button"
            onClick={() => notify('Step saved in memory only.')}
            className={primaryButtonClass}
          >
            Save and continue <ChevronRight className="size-3.5" />
          </button>
        </div>
      </main>
    </div>
  );
}

function StateLedger({ state, message }: { state: PrototypeState; message: string }) {
  return (
    <div className="border-t border-white/15 bg-[#050505] px-4 py-4 font-mono text-[10px] text-white/45 lg:px-7">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <Terminal className="size-3" /> Prototype state
        </span>
        <span>enabled={String(state.enabled)}</span>
        <span>activeEnvironment={state.activeEnvironment}</span>
        <span>test={state.environments.test.status}</span>
        <span>production={state.environments.production.status}</span>
        <span>secrets=masked</span>
      </div>
      <div className="text-white/30">lastAction={message || 'none'}</div>
      <details className="mt-3 border-t border-white/10 pt-3" open>
        <summary className="cursor-pointer select-none text-white/55">
          Full masked configuration
        </summary>
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-white/35">
          {JSON.stringify(state, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function PunchoutConfigPrototype() {
  const searchParams = useSearchParams();
  const requestedVariant = searchParams.get('variant');
  const variant = variants.some((item) => item.key === requestedVariant)
    ? (requestedVariant as (typeof variants)[number]['key'])
    : variants[0].key;
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState('');

  function toggleEnabled() {
    setState((current) => ({ ...current, enabled: !current.enabled }));
    setMessage(
      state.enabled
        ? 'Connection disabled. Configuration retained.'
        : 'Connection enabled in memory only.',
    );
  }

  return (
    <div className="min-h-[calc(100vh-60px)] bg-black pb-24 text-white">
      <PrototypeHeader enabled={state.enabled} onToggle={toggleEnabled} />
      {variant === 'control-room' ? (
        <VariantControlRoom state={state} setState={setState} notify={setMessage} />
      ) : null}
      {variant === 'matrix' ? <VariantMatrix state={state} notify={setMessage} /> : null}
      {variant === 'guided' ? (
        <VariantGuided state={state} setState={setState} notify={setMessage} />
      ) : null}
      <StateLedger state={state} message={message} />
      <PrototypeSwitcher variants={variants} current={variant} />
    </div>
  );
}
