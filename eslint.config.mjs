import { defineConfig, globalIgnores } from 'eslint/config';
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});
const webFiles = ['apps/web/**/*.{js,jsx,ts,tsx}'];

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/node_modules/**',
    'packages/db/src/migrations/**',
  ]),
  ...tseslint.configs.recommended,
  ...compat
    .extends('next/core-web-vitals', 'next/typescript')
    .map((config) => ({ ...config, files: webFiles })),
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
    // Existing pages intentionally own their loading callbacks and image URLs.
    // Re-enable these rules as those call sites are migrated deliberately.
    files: webFiles,
    rules: {
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]);
