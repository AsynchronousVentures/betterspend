import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

const webFiles = ['apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}'];
const scopeNextConfig = (config) => ('ignores' in config ? config : { ...config, files: webFiles });

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/node_modules/**',
    'packages/db/src/migrations/**',
  ]),
  ...tseslint.configs.recommended,
  ...nextCoreWebVitals.map(scopeNextConfig),
  ...nextTypescript.map(scopeNextConfig),
  {
    // The applications predate this lint baseline. Keep these known classes of
    // legacy debt explicit while enforcing the rest of the recommended rules.
    files: ['apps/{api,web}/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // These existing views intentionally own their loading callbacks. New files
    // must satisfy exhaustive-deps while these call sites are migrated.
    files: [
      'apps/web/src/app/addons/page.tsx',
      'apps/web/src/app/audit/page.tsx',
      'apps/web/src/app/budgets/\\[id\\]/page.tsx',
      'apps/web/src/app/catalog/page.tsx',
      'apps/web/src/app/gl-mappings/page.tsx',
      'apps/web/src/app/software-licenses/page.tsx',
      'apps/web/src/app/spend-guard/page.tsx',
      'apps/web/src/app/start/page.tsx',
      'apps/web/src/app/workspace-settings/page.tsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // React Hooks 7, included by Next.js 16, flags the existing client
    // data-loading effects that set state. Migrating those effects is a
    // separate behavior-sensitive refactor, so keep this exception limited to
    // the current call sites while enforcing the rule for new files.
    files: [
      'apps/web/src/app/(dashboard)/ap-aging/page.tsx',
      'apps/web/src/app/account/verify-email/page.tsx',
      'apps/web/src/app/addons/page.tsx',
      'apps/web/src/app/catalog/page.tsx',
      'apps/web/src/app/compliance/page.tsx',
      'apps/web/src/app/contracts/\\[id\\]/page.tsx',
      'apps/web/src/app/contracts/page.tsx',
      'apps/web/src/app/currencies/page.tsx',
      'apps/web/src/app/entities/page.tsx',
      'apps/web/src/app/gl-mappings/page.tsx',
      'apps/web/src/app/intake/page.tsx',
      'apps/web/src/app/inventory/page.tsx',
      'apps/web/src/app/invoices/\\[id\\]/page.tsx',
      'apps/web/src/app/invoices/page.tsx',
      'apps/web/src/app/notifications/page.tsx',
      'apps/web/src/app/payment-runs/page.tsx',
      'apps/web/src/app/purchase-orders/page.tsx',
      'apps/web/src/app/reports/page.tsx',
      'apps/web/src/app/requisitions/new/page.tsx',
      'apps/web/src/app/requisitions/page.tsx',
      'apps/web/src/app/requisitions/templates/page.tsx',
      'apps/web/src/app/rfq/page.tsx',
      'apps/web/src/app/risk-screening/page.tsx',
      'apps/web/src/app/search/page.tsx',
      'apps/web/src/app/settings/page.tsx',
      'apps/web/src/app/software-licenses/page.tsx',
      'apps/web/src/app/spend-guard/page.tsx',
      'apps/web/src/app/tax-codes/page.tsx',
      'apps/web/src/app/vendor-portal/page.tsx',
      'apps/web/src/app/vendors/onboarding/page.tsx',
      'apps/web/src/app/workspace-settings/page.tsx',
      'apps/web/src/components/access-provider.tsx',
      'apps/web/src/components/account-profile-form.tsx',
      'apps/web/src/components/app-shell.tsx',
      'apps/web/src/components/document-uploader.tsx',
      'apps/web/src/components/gl-export-history.tsx',
      'apps/web/src/components/message-thread.tsx',
      'apps/web/src/components/sidebar-nav.tsx',
      'apps/web/src/lib/branding.ts',
      'apps/web/src/lib/use-media-query.ts',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // These existing flows intentionally use full-document navigation,
    // including the auth reset. Client routing changes their loading and
    // session-reset behavior, so keep the legacy exception to these call sites.
    files: [
      'apps/web/src/app/inventory/page.tsx',
      'apps/web/src/app/vendors/page.tsx',
      'apps/web/src/lib/api.ts',
    ],
    rules: {
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
  {
    // The message thread records its active key before starting async loads so
    // late responses can be rejected. Moving this write into an effect creates
    // a stale-key window, so preserve the existing race handling here.
    files: ['apps/web/src/components/message-thread.tsx'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    // These existing components render user-controlled or preview image URLs.
    // New files must use the Next.js image component by default.
    files: [
      'apps/web/src/app/workspace-settings/page.tsx',
      'apps/web/src/components/account-profile-form.tsx',
      'apps/web/src/components/app-shell.tsx',
      'apps/web/src/components/sidebar-account.tsx',
    ],
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
]);
