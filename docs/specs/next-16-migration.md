# Next.js 16 migration

Status: implemented

Validation: Next.js 16.3.3 Turbopack build, 48 web tests, full preflight, Docker preflight, and standalone container smoke all passed.

## Goal

Move the web application from Next.js 15.5.21 to Next.js 16.3.3 in one focused change. Preserve current authentication, routing, rendering, lint, and standalone-container behavior while adopting the supported Next.js 16 conventions.

Next.js 16.3.3 is the current Active LTS patch as of August 28, 2026. It is also the required 16.x version from the August 2026 security release, which fixes two critical vulnerabilities. The fallback release line is patched Next.js 15.5.24, not the currently installed 15.5.21. See the [Next.js August 2026 security release](https://nextjs.org/blog/august-2026-security-release) and [Next.js support policy](https://nextjs.org/support-policy).

## Decisions

- Target `next` 16.3.3 and `eslint-config-next` 16.3.3. Keep the existing manifest style, `^16.3.3` for the application dependency and an exact `16.3.3` for the root ESLint config, with 16.3.3 resolved in `pnpm-lock.yaml`.
- Keep React and React DOM at 19.2.8. Next.js 16 uses React 19.2 in the App Router, and the repository is already on the current stable packages. Keep `@types/react` at 19.2.18 and update `@types/react-dom` from 19.2.4 to 19.2.5 so the React type packages are current together. See the [Next.js 16 release](https://nextjs.org/blog/next-16) and [React versions policy](https://react.dev/versions).
- Keep Node.js 22 in CI and all Docker stages. Next.js 16 requires Node.js 20.9.0 or newer, while BetterSpend already develops, builds, and runs on Node.js 22. Correct the stale `Node.js 20+` prerequisite in the root `AGENTS.md` to Node.js 22; no runtime image change is needed. TypeScript 5.1 or newer is required, and the repository's TypeScript 5.7 manifest range satisfies that requirement. See the [Next.js 16 runtime requirements](https://nextjs.org/docs/app/guides/upgrading/version-16#nodejs-runtime-and-browser-support).
- Keep pnpm 10.15.1. The official upgrade guide specifies no higher pnpm floor, and the repository already pins pnpm through `packageManager` and CI. See the [pnpm upgrade path](https://nextjs.org/docs/app/guides/upgrading/version-16#using-the-codemod).
- Adopt Turbopack for development and production builds, which is the Next.js 16 default. Do not add `--webpack` preemptively.
- Rename Middleware to Proxy and use its Node.js runtime. BetterSpend does not declare or depend on the Edge runtime.
- Keep Cache Components disabled. Enabling it is a separate rendering and caching design change, not a mechanical rename.
- Preserve the current instant route-transition scroll behavior by opting into Next.js's smooth-scroll override on the root `<html>` element.
- Convert the root Next.js ESLint setup from `FlatCompat` to the native flat exports from `eslint-config-next` 16. Keep the existing file scope and explicit legacy-debt exceptions.

## Target matrix

| Item                 | Current          | Target           | Repository evidence                                                   |
| -------------------- | ---------------- | ---------------- | --------------------------------------------------------------------- |
| Next.js              | 15.5.21          | 16.3.3           | `apps/web/package.json`, `pnpm-lock.yaml`                             |
| `eslint-config-next` | 15.5.21          | 16.3.3           | `package.json`, `pnpm-lock.yaml`                                      |
| React                | 19.2.8           | 19.2.8           | `apps/web/package.json`, `pnpm-lock.yaml`                             |
| React DOM            | 19.2.8           | 19.2.8           | `apps/web/package.json`, `pnpm-lock.yaml`                             |
| React types          | 19.2.18 / 19.2.4 | 19.2.18 / 19.2.5 | `apps/web/package.json`, `pnpm-lock.yaml`                             |
| Node.js              | 22               | 22               | `README.md`, `docker/*.Dockerfile`, `.github/workflows/docker-ci.yml` |
| TypeScript           | `^5.7.0`         | unchanged        | `package.json`, `apps/web/package.json`                               |
| pnpm                 | 10.15.1          | unchanged        | `package.json`, `.github/workflows/docker-ci.yml`                     |

Next.js 16 also raises its browser floor to Chrome 111, Edge 111, Firefox 111, and Safari 16.4. BetterSpend does not declare a separate browser support matrix, so this migration adopts that floor. See the [official runtime and browser table](https://nextjs.org/docs/app/guides/upgrading/version-16#nodejs-runtime-and-browser-support).

## Repository inventory

The web application uses the App Router exclusively under `apps/web/src/app`; there is no Pages Router tree.

- `apps/web/package.json` runs plain `next dev`, `next build`, and `next start`. These commands will switch to Turbopack automatically in Next.js 16.
- `apps/web/next.config.ts` contains only `output: 'standalone'`, `outputFileTracingRoot`, and `transpilePackages`. It has no custom Webpack config, `experimental.turbopack`, image config, runtime config, PPR, Cache Components, AMP, or removed `devIndicators` options.
- `docker/web.Dockerfile` packages `.next/standalone`, `.next/static`, and `public`. The production Turbopack build must preserve this layout.
- `apps/web/src/middleware.ts` performs token-gated redirects and exports a matcher. `apps/web/src/middleware.test.ts` imports its `isPublicPath` helper. Both names and the exported function need to move to the Proxy convention.
- Ten dynamic App Router pages accept `params: Promise<{ id: string }>`: approvals, budgets, catalog, contracts, invoices, purchase orders, receiving, requisitions, RFQs, and software licenses. The RFQ page awaits `params`; nine client detail pages currently resolve it with `.then` and need the manual `use(props.params)` conversion described below.
- Thirteen client pages use `useSearchParams()`: account verification, addons, GL mappings, inventory, login, payment runs, punchout catalog, new receiving, new requisitions, password reset, search, vendor portal, and workspace settings. That client hook is not the `searchParams` page prop and needs no async migration.
- There are no imports from `next/headers` or `next/cache`, and no calls to `cookies()`, `headers()`, `draftMode()`, `revalidateTag()`, `cacheLife()`, or `cacheTag()`.
- `apps/web/src/app/runtime-version/route.ts` explicitly uses `dynamic = 'force-dynamic'` and `revalidate = 0`. Those settings remain valid because this plan leaves Cache Components off.
- There are no sitemap generators, generated metadata image routes, parallel route slots, Server Actions, or `next/image` imports.
- The application uses raw `<img>` elements for user-controlled and preview images. The new `next/image` defaults therefore do not affect current behavior.
- `apps/web/src/app/globals.css` sets `html { scroll-behavior: smooth; }`, while `apps/web/src/app/layout.tsx` does not set `data-scroll-behavior`.
- `eslint.config.mjs` is already a flat config and the package scripts already call ESLint directly, but the Next presets are loaded through the legacy `FlatCompat` adapter. `scripts/ci-preflight.mjs` and CI run lint separately from the application build.
- There is no Sass, Babel config, custom Webpack plugin, Edge runtime declaration, or code that inspects `process.argv` during Next config loading.
- `.gitignore` ignores `.next`, so the new `.next/dev` output and Turbopack filesystem caches remain untracked.

## Changes that apply

### Turbopack becomes the default

Next.js 16 uses Turbopack for both `next dev` and `next build`. A custom Webpack configuration would make the default build fail, while `--webpack` remains an opt-out. BetterSpend has no Webpack customization, so keep the existing scripts and validate Turbopack directly. Filesystem caching is enabled by default for development and builds in the target release. See the [Turbopack migration section](https://nextjs.org/docs/app/guides/upgrading/version-16#turbopack-by-default).

The main repository-specific risk is the standalone production artifact, not bundler configuration. Verify both `pnpm --filter @betterspend/web build` and `docker/web.Dockerfile`. Do not ship `next build --webpack` unless a confirmed upstream blocker is documented in the pull request.

### Middleware becomes Proxy

Next.js 16 deprecates `middleware.ts` in favor of `proxy.ts` and deprecates the `middleware` named export in favor of `proxy`. Proxy always runs on Node.js and does not accept a runtime override. See the [Proxy convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) and [Next.js 16 migration guide](https://nextjs.org/docs/app/guides/upgrading/version-16#middleware-to-proxy).

Apply the mechanical rename, then make the repository names consistent:

- Rename `apps/web/src/middleware.ts` to `apps/web/src/proxy.ts`.
- Rename `middleware` to `proxy`; keep `isPublicPath`, the matcher, and redirect behavior unchanged.
- Rename `apps/web/src/middleware.test.ts` to `apps/web/src/proxy.test.ts` and update its import.
- Keep the existing matcher exclusions and token-cookie behavior.

### Async request APIs are mandatory

Next.js 16 removes the temporary synchronous access supported by Next.js 15 for `params`, `searchParams`, `cookies()`, `headers()`, and `draftMode()`. Metadata image and sitemap generator parameters also become async. See the [async request API migration](https://nextjs.org/docs/app/guides/upgrading/version-16#async-request-apis-breaking-change), [async metadata image parameters](https://nextjs.org/docs/app/guides/upgrading/version-16#async-parameters-for-icon-and-open-graph-image-breaking-change), and [async sitemap IDs](https://nextjs.org/docs/app/guides/upgrading/version-16#async-id-parameter-for-sitemap-breaking-change).

The server RFQ route already awaits `params`. The nine client detail pages need a manual `use(props.params)` conversion. The dry-run async codemod identifies those pages, but its output cannot be applied verbatim because the existing components still call `.then()` on the promise after the wrapper change. Use the dry run as an inventory, convert each stale callback to the resolved params value, and search for unresolved codemod markers. Generate route types and let the Next 16 build validate every App Router signature.

### ESLint and build behavior

Next.js 16 removes `next lint`; `next build` no longer runs lint; and `eslint-config-next` defaults to native flat config. BetterSpend already calls `eslint src --max-warnings 0` and runs lint before build in local preflight and CI, so validation coverage remains intact. See the [ESLint removal and flat-config guidance](https://nextjs.org/docs/app/guides/upgrading/version-16#next-lint-command) and [official flat-config setup](https://nextjs.org/docs/app/api-reference/config/eslint#setup-eslint).

Replace `FlatCompat` usage with the native arrays exported by `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. Continue limiting Next rules to `apps/web/**/*.{js,jsx,ts,tsx}` and preserve the current rule exceptions. Remove `@eslint/eslintrc` only if no other repository file uses it after the conversion.

Next.js 16 also removes `size` and `First Load JS` from build output. No BetterSpend script parses those metrics, so this only changes logs. See the [build output change](https://nextjs.org/docs/app/guides/upgrading/version-16#performance-improvements).

### Smooth scrolling changes

Next.js no longer temporarily changes a global `scroll-behavior: smooth` rule to `auto` during client navigation unless the root document opts in. BetterSpend has the global smooth-scroll rule, so add `data-scroll-behavior="smooth"` to the root `<html>` in `apps/web/src/app/layout.tsx` to preserve the prior instant route-to-top behavior. See the [scroll behavior migration](https://nextjs.org/docs/app/guides/upgrading/version-16#scroll-behavior-override).

### Navigation prefetch behavior changes

Next.js 16 deduplicates shared layouts and prefetches route segments incrementally. No code change is required, but browser and network observations may show more, smaller prefetch requests. BetterSpend has broad `Link` and router navigation use, so the browser smoke pass must cover sidebar navigation, a list-to-detail transition, back navigation, and query-string navigation. See the [routing and navigation change](https://nextjs.org/docs/app/guides/upgrading/version-16#enhanced-routing-and-navigation).

### Development and build outputs

`next dev` now writes to `.next/dev`, separate from `next build`, and Next uses locks to reject concurrent commands of the same kind. BetterSpend does not read development output paths, and its `.next` ignore covers the new directory. The production Dockerfile still reads build output from `.next/standalone` and `.next/static`. See [concurrent development and build behavior](https://nextjs.org/docs/app/guides/upgrading/version-16#concurrent-dev-and-build).

## Reviewed changes that do not require migration work

- Cache Components, PPR, and the caching APIs remain out of scope. The repository has no `next/cache` calls or removed experimental flags. `revalidateTag` now needs a cache-life profile, and `cacheLife` and `cacheTag` lose their `unstable_` prefixes, but there are no call sites. Enabling `cacheComponents` can impose Suspense and uncached-data requirements, so leave it off. See [caching APIs](https://nextjs.org/docs/app/guides/upgrading/version-16#caching-apis), [PPR](https://nextjs.org/docs/app/guides/upgrading/version-16#partial-prerendering-ppr), and [removed cache flags](https://nextjs.org/docs/app/guides/upgrading/version-16#experimentaldynamicio-and-experimentalusecache).
- The changed `next/image` defaults do not apply because the repository has no `next/image` or `next/legacy/image` imports and no `images` config. This includes local query-string allowlists, a four-hour minimum cache TTL, removal of 16px from default sizes, `[75]` as the quality allowlist, local-IP blocking, and the three-redirect maximum. See the [Next Image changes](https://nextjs.org/docs/app/guides/upgrading/version-16#nextimage-changes).
- The new requirement for explicit `default.js` files in parallel route slots does not apply because `apps/web/src/app` has no `@slot` directories. See [parallel route defaults](https://nextjs.org/docs/app/guides/upgrading/version-16#parallel-routes-defaultjs-requirement).
- Removed AMP, `serverRuntimeConfig`, `publicRuntimeConfig`, old `devIndicators` fields, `experimental.dynamicIO`, `experimental.useCache`, experimental PPR, and `unstable_rootParams` do not appear in the repository. See the [Next.js 16 removals](https://nextjs.org/docs/app/guides/upgrading/version-16#removals).
- Deprecated `next/legacy/image` and `images.domains` do not appear in the repository.
- Turbopack config relocation, Sass import rules, Babel handling, and `process.argv` config-load behavior do not apply because the relevant config and source patterns are absent.
- React Compiler support is stable but opt-in. Do not enable it in this migration because it changes compilation and adds a Babel plugin. See [React Compiler support](https://nextjs.org/docs/app/guides/upgrading/version-16#react-compiler-support).

## Implementation plan

### Phase 1: establish a clean upgrade baseline

1. Start from current `main` with a clean worktree and create one migration branch.
2. Record passing targeted checks on Next.js 15.5.21: web lint, web tests, web typecheck, and web build.
3. Run the Next agent-doc setup from `apps/web` and review the managed block it creates in `apps/web/AGENTS.md`. Next.js 16.2 and later bundle version-matched docs under the installed package. From that file, the durable reference is `node_modules/next/dist/docs/`. Use the repository's writing-for-agents workflow for this edit. See the [Next.js agent-doc setup](https://nextjs.org/docs/app/guides/upgrading/version-16#set-up-ai-agent-docs).

```bash
cd apps/web
pnpm dlx @next/codemod@16.3.3 agents-md
```

### Phase 2: run the mechanical migration

Run the upgrade codemod from the web workspace with both the tool and target pinned to 16.3.3. The official `upgrade` command accepts an exact revision and selects the relevant transforms. See the [upgrade codemod reference](https://nextjs.org/docs/app/guides/upgrading/codemods#upgrade).

```bash
cd apps/web
pnpm dlx @next/codemod@16.3.3 upgrade 16.3.3 --verbose
```

The version 16 upgrade can update dependencies and apply the Turbopack, ESLint CLI, Middleware-to-Proxy, stable cache API, and PPR transforms. Review every selected transform before accepting it. See the [version 16 codemod list](https://nextjs.org/docs/app/guides/upgrading/version-16#using-the-codemod).

Audit the async request migration separately. This should produce no edits in the current repository:

```bash
pnpm dlx @next/codemod@16.3.3 next-async-request-api apps/web/src --dry
rg -n '@next-codemod|UnsafeUnwrapped' apps/web/src
```

If the upgrade command did not migrate Proxy, run the focused transform once:

```bash
pnpm dlx @next/codemod@16.3.3 middleware-to-proxy apps/web/src
```

### Phase 3: make repository-specific edits

1. Align root `eslint-config-next` with 16.3.3 and replace `FlatCompat` with the native flat-config exports.
2. Remove `@eslint/eslintrc` if the repository no longer imports it.
3. Finish the `middleware.ts` to `proxy.ts` and test-file renames. Preserve matcher and authentication logic exactly.
4. Add `data-scroll-behavior="smooth"` to the root HTML element.
5. Keep React and React DOM at 19.2.8; align the React DOM types to 19.2.5.
6. Update the Next.js version badge and stack entry in `README.md`, plus the stale Node prerequisite in the root `AGENTS.md`.
7. Regenerate `pnpm-lock.yaml` with pnpm 10.15.1 and inspect the diff for unrelated upgrades.
8. Verify the Next-managed `apps/web/AGENTS.md` block points to bundled 16.3.3 docs and no temporary `.next-docs` directory remains.

### Phase 4: static and build validation

Run these checks in order so failures stay attributable:

```bash
pnpm install --frozen-lockfile
pnpm --filter @betterspend/web exec next typegen
pnpm --filter @betterspend/web lint
pnpm --filter @betterspend/web test
pnpm --filter @betterspend/web typecheck
pnpm --filter @betterspend/web build
pnpm ci:preflight
pnpm ci:preflight:docker
```

The Docker tier is required because the shipped web image consumes Next's standalone output. Confirm the image still starts as the unprivileged `betterspend` user and serves static assets.

### Phase 5: runtime validation

Run the local application with its normal infrastructure and inspect browser and server logs.

1. Visit `/login`, `/signup`, `/punchout`, and `/runtime-version` without `bs_token`; they must remain public.
2. Visit a protected path without `bs_token`; it must redirect to `/login?next=<path>`.
3. Sign in and open the dashboard, a list page, and a dynamic detail page. Confirm data loads without hydration, route-type, or Proxy errors.
4. Navigate through the sidebar, list-to-detail links, back navigation, and pages that update query strings. Confirm history, focus, and scroll position remain usable.
5. Reload a protected route and verify the authentication boundary behaves the same under Node.js Proxy.
6. Verify `/runtime-version` remains dynamic and returns the deployed version.
7. Check that `next dev` and `next build` emit no migration deprecations, codemod markers, or unexpected Webpack fallback.

## Risks and rollback

### Turbopack or standalone packaging regression

This is the highest technical risk because production builds change bundlers. The temporary diagnostic fallback is `next build --webpack`, as documented in the [Turbopack opt-out](https://nextjs.org/docs/app/guides/upgrading/version-16#opting-out-of-turbopack). Prefer fixing an application incompatibility or documenting an upstream issue. Shipping the migration on Webpack requires an explicit decision and follow-up issue.

### Authentication boundary regression

The Proxy rename also changes the declared runtime from the old convention to fixed Node.js behavior. The existing code uses APIs supported by Node.js Proxy, but a matcher or export-name mistake could expose routes or create redirect loops. Keep the logic unchanged, retain the focused unit test, and verify public and protected routes in a real browser.

### ESLint rule drift

Native flat exports can expose a different merge order than `FlatCompat`. Preserve the current web-only scope and explicit exceptions. Fix valid new findings; do not add broad disables merely to make the upgrade green.

### Navigation and scroll regression

The new prefetch implementation and smooth-scroll default are visible behavior changes. The root attribute preserves the old scroll override, while the browser smoke pass checks routes that use both links and query parameters.

### Rollback procedure

The migration contains no database or API contract change. Revert the complete migration commit and redeploy the prior immutable application image if an urgent production rollback is required. Do not leave `proxy.ts`, Next 16-only lint configuration, or generated lockfile changes in a Next 15 checkout.

The currently installed Next.js 15.5.21 is not an acceptable steady-state rollback target after the August security release. If the application must remain on 15.x, follow the same revert with a focused upgrade to patched 15.5.24 and rebuild the image. That recommendation follows the [official security release](https://nextjs.org/blog/august-2026-security-release).

## Non-goals

- Enabling Cache Components, `use cache`, Partial Prerendering, or new cache invalidation APIs.
- Enabling React Compiler, View Transitions, or other React 19.2 features.
- Replacing raw user-image previews with `next/image`.
- Redesigning authentication or changing the `bs_token` cookie contract.
- Adding Server Actions, parallel routes, metadata generators, or sitemap generators.
- Changing Node.js, pnpm, TypeScript, Tailwind, Turborepo, or deployment topology beyond documentation needed for the Next.js requirement.
- Folding unrelated Dependabot alerts or package overrides into the framework migration. Those fixes should remain a separate, reviewable dependency change unless Next.js 16 directly changes the same locked package.
- Tuning Turbopack filesystem caching or adding custom bundler configuration before measurements show a need.

## Acceptance criteria

- `apps/web/package.json` and `pnpm-lock.yaml` resolve Next.js 16.3.3; root `eslint-config-next` is 16.3.3.
- React and React DOM remain on 19.2.8 with current matching type packages.
- CI and runtime remain on Node.js 22, and repository prerequisites no longer imply that Node versions below 20.9 are supported.
- The application uses `proxy.ts` and a `proxy` export; no deprecated Middleware convention remains.
- All async request API sites compile without compatibility casts, `UnsafeUnwrapped` types, or `@next-codemod` markers.
- Turbopack completes the production build with no `--webpack` flag.
- The standalone Docker image builds, starts, serves static assets, and reports the runtime version.
- ESLint uses native Next.js flat-config exports, and lint still runs independently before builds.
- Public and protected route behavior is unchanged in unit and browser checks.
- Client navigation, query-string navigation, and global smooth-scroll behavior pass the runtime smoke test.
- `pnpm ci:preflight` and `pnpm ci:preflight:docker` pass.
- The final diff contains no unrelated dependency upgrades, temporary generated docs, or untracked Next build output.
- The pull request is limited to the migration, explains the problem and solution directly, and uses the repository's normal review and CI process.
