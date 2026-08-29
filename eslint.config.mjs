import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

const webFiles = ['apps/web/**/*.{js,jsx,ts,tsx}'];
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
    // separate behavior-sensitive refactor, so keep this exception web-scoped.
    files: webFiles,
    rules: {
      'react-hooks/set-state-in-effect': 'off',
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
