# BetterSpend Branding & Design System

Reference for keeping features visually consistent. Everything here is derived from the
live code — treat these files as the source of truth when this doc and the code disagree:

- `apps/web/src/app/globals.css` — all design tokens (Tailwind v4 `@theme inline` + `:root`)
- `apps/web/src/components/ui/` — shared primitives (shadcn-based, `new-york` style, lucide icons)
- `apps/web/src/components/` — `app-shell.tsx`, `page-header.tsx`, `status-badge.tsx`, `resource-state.tsx`
- `apps/web/src/app/recurring-po/page.tsx` — the canonical exemplar page

## 1. Brand overview

BetterSpend is a warm, paper-like, light-only product UI:

- **Warm paper background** (`#f5f4f0`) with pure-white cards floating on it. The whole
  app reads as ink on warm paper, not gray-on-gray SaaS.
- **Ember orange primary** (`#d4522e`) — the single action color: primary buttons, links,
  focus rings, active nav, unread markers.
- **Deep teal accent** (`#1f4f46`) — a quiet counterweight to ember, used sparingly.
- **One dark surface: the sidebar** (`#18191d`, charcoal with warm cream text). Nothing
  else in the app is dark. Pages, cards, dialogs, dropdowns are always light.
- **Soft geometry**: small default radius (`0.375rem`), oversized `rounded-[28px]` hero
  cards, gentle layered shadows, subtle 150ms transitions and short fade/slide entrances.
- Typography is **Plus Jakarta Sans** with tight negative tracking on headings and
  wide-tracked uppercase micro-labels ("eyebrows") for structure.

## 2. Color system

All colors live as CSS variables in `globals.css` `:root` and are mapped to Tailwind
utilities via `@theme inline` (`--color-background: var(--background)` etc.). **Always
use the token utilities** — `bg-background`, `bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border/70`, `bg-primary` — never literal palette
classes (`bg-white`, `text-neutral-500`, `bg-orange-600`) for surfaces, text, or borders.

### Core tokens

| Token | Hex | Tailwind usage | Role |
|---|---|---|---|
| `--background` | `#f5f4f0` | `bg-background` | Warm paper page background |
| `--foreground` | `#1a1a1a` | `text-foreground` | Primary ink |
| `--card` / `--card-foreground` | `#ffffff` / `#1a1a1a` | `bg-card text-card-foreground` | Card surfaces |
| `--popover` / `--popover-foreground` | `#ffffff` / `#1a1a1a` | `bg-popover` | Dropdowns, menus |
| `--primary` / `--primary-foreground` | `#d4522e` / `#ffffff` | `bg-primary text-primary-foreground` | Ember: actions, links, focus |
| `--secondary` / `--secondary-foreground` | `#eae6df` / `#3d3530` | `bg-secondary` | Warm-taupe secondary buttons/chips |
| `--muted` / `--muted-foreground` | `#edebe7` / `#6b6560` | `bg-muted text-muted-foreground` | Subtle fills, secondary text |
| `--accent` / `--accent-foreground` | `#1f4f46` / `#eefaf6` | `bg-accent text-accent-foreground` | Deep teal accent (sparing) |
| `--destructive` / `--destructive-foreground` | `#c23b33` / `#fff7f6` | `bg-destructive` | Destructive actions/errors |
| `--success` / `--success-foreground` | `#1f7a4f` / `#f2fff7` | `bg-success` | Positive state |
| `--warning` / `--warning-foreground` | `#f0a230` / `#422503` | `bg-warning` | Caution state |
| `--border` | `#ddd9d2` | `border-border` (usually `border-border/70`) | Hairlines, card edges |
| `--input` | `#d0ccc5` | `border-input` | Form control borders |
| `--ring` | `#d4522e` | `ring-ring` | Focus ring (ember) |
| `--ember-50` / `--ember-100` | `#f9efe4` / `#f2decb` | `bg-ember-50` / `bg-ember-100` | Warm ember tint fills |

### Sidebar tokens (the only dark surface)

| Token | Value | Usage |
|---|---|---|
| `--sidebar` | `#18191d` | `bg-sidebar` — charcoal sidebar background |
| `--sidebar-foreground` | `#f6ede2` | `text-sidebar-foreground` — warm cream text |
| `--sidebar-muted` | `#a79b8b` | `text-sidebar-muted` — secondary sidebar text |
| `--sidebar-border` | `rgba(255, 245, 228, 0.08)` | `border-sidebar-border` |
| `--sidebar-accent` / `--sidebar-accent-foreground` | `#d4522e` / `#ffffff` | Active nav item |

### Semantic tone accents (hardcoded Tailwind palette — allowed only here)

For small semantic status accents (badge fills, stat-card icon chips, tinted action
buttons) the codebase uses the Tailwind `emerald` / `amber` / `sky` / `rose` families in
the 50–700/800 range. This is the **only** sanctioned use of literal palette classes:

- Positive: `bg-emerald-50 text-emerald-700` (chips), `bg-emerald-100 text-emerald-800` (badges), `border-emerald-200 text-emerald-700 hover:bg-emerald-50` (tinted outline buttons)
- Caution: same recipes with `amber`
- Informational: same recipes with `sky`
- Negative: same recipes with `rose` (e.g. delete buttons: `border-rose-200 text-rose-700 hover:bg-rose-50`)
- `violet-100/800` appears for the vendor type chip in global search

Rules:

- **Pages are light-only.** Never introduce dark surfaces outside the sidebar. The only
  dark-ish values elsewhere are modal scrims (`bg-slate-950/45` in `ui/dialog.tsx`,
  `bg-slate-950/50` in page-level overlays) — dimming layers, not surfaces.
- Tone colors are for **small accents only** — never page sections, whole cards, or body text.
- Text selection is an ember tint (`color-mix(in srgb, var(--primary) 28%, white)`), set globally.

## 3. Typography

Fonts are loaded via `next/font` in `apps/web/src/app/layout.tsx` and exposed as theme vars:

- `--font-sans` → **Plus Jakarta Sans** (`font-sans`, applied to `body`)
- `--font-mono` → **JetBrains Mono** (`font-mono`)

Scale (copy-pasteable recipes, all verified in code):

| Role | Recipe |
|---|---|
| Page title (h1, via `PageHeader`) | `text-[1.75rem] font-semibold tracking-[-0.02em] text-foreground` |
| Section / modal title | `text-2xl font-semibold tracking-[-0.03em] text-foreground` |
| Hero-card title | `text-xl tracking-[-0.03em]` on `CardTitle` (which adds `font-semibold tracking-tight`) |
| Sub-card title | `CardTitle` with `text-base` |
| Stat value | `text-lg font-semibold tracking-[-0.03em] text-foreground` |
| Body / descriptions | `text-sm text-muted-foreground` (page descriptions add `max-w-2xl`) |
| **Eyebrow label** (form labels, stat labels) | `text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground` |
| Table header cells | `text-[10.5px] font-semibold uppercase tracking-[0.15em] text-muted-foreground` (built into `TableHead`) |
| Timestamps / metadata | `text-[11px] uppercase tracking-[0.18em] text-muted-foreground` |

The eyebrow label is the signature micro-typography move — use it for field labels, stat
captions, and grouped-list headers. Tracking varies slightly by context (`0.15em`–`0.24em`);
default to `tracking-[0.18em]`.

**Monospace** (`font-mono text-xs`) is for machine-ish strings only: SKUs, record IDs,
connection IDs, keyboard shortcuts, error codes. Example SKU chip:
`rounded-md bg-primary/10 px-2 py-1 font-mono text-xs font-semibold text-primary`.

## 4. Layout & spacing

The app shell (`app-shell.tsx`) provides:

- **Dark sidebar** — `bg-sidebar text-sidebar-foreground`, sticky full-height; 268px
  expanded, 88px collapsed, 280px mobile drawer over a `bg-[rgba(19,18,21,0.48)]` scrim.
- **Light main column** — sticky top bar (`border-b border-border/70 bg-background/92
  backdrop-blur-md`) with global search, entity switcher, notifications; content centered
  in `mx-auto w-full max-w-[1440px]`.
- **Pages supply their own padding.** The canonical page root is:

```tsx
<div className="space-y-6 p-4 md:p-6">
  <PageHeader title="..." description="..." actions={<Button>...</Button>} />
  {/* sections */}
</div>
```

- **PageHeader** (`page-header.tsx`): title + optional description on the left, actions
  right-aligned on `lg`; `border-b border-border/60 pb-5` underline; enters with
  `animate-[fadeIn_0.25s_ease-out_both]`.
- **Stat rows**: `<section className="grid gap-4 md:grid-cols-3">` of standard Cards with
  `CardContent className="flex items-center gap-4 p-5"`, an `h-11 w-11 rounded-lg` tone
  icon chip, eyebrow label, and stat value.

### Radius scale

| Token / class | Value | Use |
|---|---|---|
| `rounded-sm` | 2px | rare, tiny elements |
| `rounded-md` | `calc(0.375rem - 2px)` | buttons, inputs, small chips |
| `rounded-lg` / `--radius` | 0.375rem | **standard**: cards, tables, list rows |
| `rounded-xl` | `calc(0.375rem + 2px)` | slightly softer containers |
| `rounded-[28px]` | 28px | **hero cards**: main table card, empty states |
| `rounded-[30px]` / `rounded-[22px]` | 30 / 22px | large modal panels / nested line-item rows |

Card recipes:

- Standard card: `Card` default — `rounded-lg border border-border/70 bg-card shadow-sm`
- Hero/table card: `<Card className="overflow-hidden rounded-[28px] border-border/70 bg-card/95">` with `CardHeader className="border-b border-border/70 pb-4"` and `CardContent className="p-0"` when it wraps a Table
- Empty state: `<Card className="rounded-[28px] border-dashed border-border/80 bg-card/80">` with centered icon chip + copy
- Inset list row: `rounded-lg border border-border/70 bg-background/80 px-4 py-3`
- Subtle inset panel: `rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6`

## 5. Components

Always use the primitives in `apps/web/src/components/ui/` — never raw `<button>`,
`<input>`, `<select>`, `<textarea>`, or hand-rolled tables. (Plain-text link-style
buttons like `text-xs font-semibold text-primary hover:text-primary/80` are the one
accepted raw-button pattern, used for "Clear" / "See all" affordances.)

**Button** (`ui/button.tsx`) — variants and when to use them:

| Variant | Look | Use |
|---|---|---|
| `default` | `bg-primary` ember, white text | The one primary action per view |
| `secondary` | warm taupe `bg-secondary` | Secondary actions alongside a primary |
| `outline` | `border-border bg-background`, hover `bg-muted` | Most row/toolbar actions, Retry, Cancel |
| `ghost` | transparent, hover `bg-muted` | Icon buttons, low-emphasis chrome |
| `destructive` | `bg-destructive` | Confirmed destructive actions |

Sizes: `default` (h-10), `sm` (h-8, for table rows), `lg` (h-11), `icon` (h-10 w-10).
Tinted row actions extend `outline`/`sm` with tone classes (see section 2).

**Forms** — `Input`, `Select`, `Textarea` share the recipe `h-10 rounded-md border
border-input bg-white/80 px-3 py-2 text-sm` with an inset shadow and an ember focus
treatment (`focus-visible:border-primary/40` + `0 0 0 3px rgba(212,82,46,0.1)` glow).
Wrap each control in the Field pattern from the exemplar page:

```tsx
<label className="grid gap-2">
  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Title</span>
  <Input ... />
</label>
```

Group fields inside a `Card` with `CardContent className="grid gap-4 md:grid-cols-2"`;
full-width fields take `md:col-span-2`.

**Table** (`ui/table.tsx`) — always render inside a Card (`CardContent className="p-0"`
in a `rounded-[28px]` hero card for main lists). The primitive already provides the
rounded `border-border/70` wrapper, horizontal scroll, `bg-muted/50` uppercase header,
zebra rows (`even:bg-muted/[0.12]`), and ember hover (`hover:bg-primary/[0.04]`).
Right-align action columns; use `size="sm"` buttons in cells.

**Badge / StatusBadge** — `Badge` variants: `default` (ember), `secondary`, `outline`,
`subtle`, plus tone variants `success` / `warning` / `destructive`. Never pick tone
variants ad hoc for record statuses — use `<StatusBadge value={status} />`
(`status-badge.tsx`), which owns the status→variant mapping (approved→success,
pending_approval→warning, rejected→destructive, draft→secondary, …).

**Alert** (`ui/alert.tsx`) — inline notices; `default`, `success`, `warning`,
`destructive` (tinted `-50` backgrounds with `-200` borders and `-900` text).

**Dialog** (`ui/dialog.tsx`) — Radix-based; `bg-slate-950/45` scrim, `rounded-lg`
`bg-background` panel, `max-w-xl`, built-in close button. Large multi-card editors (like
the recurring-PO modal) use a page-level overlay: `fixed inset-0 z-50 ... bg-slate-950/50
px-4 py-10` scrim with a `w-full max-w-5xl rounded-[30px] border border-border/70 bg-card
p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.55)] md:p-8` panel.

**States** (`resource-state.tsx`) — use `ListState` for list routes
(loading/empty/denied/failed with correct `role`/aria) and `PanelError` when one panel of
a loaded detail page fails. Don't hand-roll spinners or empty divs.

## 6. Shadows, motion, focus

Shadow scale (all soft, ink-tinted `rgba(26,26,26,…)`):

| Token | Value | Use |
|---|---|---|
| `shadow-xs` | `0 1px 2px 0 rgba(26,26,26,0.04)` | secondary buttons |
| `shadow-sm` | `0 2px 8px -2px rgba(26,26,26,0.08)` | cards (default) |
| `shadow-md` | `0 4px 16px -4px rgba(26,26,26,0.10)` | raised panels |
| `shadow-lg` | `0 8px 30px -8px rgba(26,26,26,0.12)` | popovers |
| `shadow-xl` | `0 16px 50px -16px rgba(26,26,26,0.16)` | dropdown panels (e.g. search results) |

Modals use bespoke deep shadows (`0_30px_100px_-40px_rgba(15,23,42,0.6)` in Dialog).
Primary/destructive buttons carry an `inset_0_1px_0_0_rgba(255,255,255,0.15)` top-light.

Motion — three keyframes in `globals.css`, all `ease-out both`:

- `fadeIn` (0.3s; opacity + 6px rise) — page/section entrances: `animate-[fadeIn_0.25s_ease-out_both]`
- `slideDown` (0.2s; 4px drop) — dropdowns: `animate-[slideDown_0.15s_ease-out_both]`
- `scaleIn` (0.2s; from 0.97) — modals/popovers
- `a`, `button`, `input`, `textarea`, and `select` get `transition-all duration-150`
  globally (per `globals.css`). Other interactive elements (custom `div` roles, radix
  triggers, etc.) need an explicit transition. Keep motion short
  (≤300ms) and entrance-only; no looping or attention-grabbing animation.

Focus — global `:focus-visible` is `outline-none ring-2 ring-ring/60 ring-offset-2
ring-offset-background` (ember ring). Buttons re-declare the same recipe. Form controls
use the border+glow treatment instead (section 5). Never remove focus styles without
replacing them with an equally visible token-based ring.

## 7. Data visualization

Follow this order when adding any chart, stat tile, or dashboard: pick the form for the
data's job first (a single headline number is a stat tile, not a chart), assign color by
job, then style marks — color choices come last, and categorical palettes must be
validated for colorblind safety, not eyeballed.

- **Categorical series** (identity): use this fixed order, validated (CVD ΔE, lightness
  band, chroma, ≥3:1 contrast) against both `#ffffff` and `#f5f4f0` surfaces:
  1. `#d4522e` (ember, = `--primary`) 2. `#0d9488` (teal) 3. `#7c3aed` (violet)
  4. `#b45309` (amber) 5. `#0369a1` (blue) 6. `#be185d` (pink).
  Assign in fixed order, never cycled; >6 series folds into "Other" or small multiples.
  Note the raw `--accent` teal `#1f4f46` **fails** chart validation (too dark/gray) — use
  `#0d9488` for data, reserve `#1f4f46` for UI accents.
- **Sequential** (magnitude): one hue, light→dark — ember tints from `--ember-50`
  `#f9efe4` through `#d4522e` toward a darkened ember. Never a rainbow.
- **Diverging** (polarity): teal pole ↔ ember pole with a neutral warm-gray midpoint —
  never a hue at the midpoint.
- **Status** in charts mirrors UI semantics (emerald/amber/rose steps) and is reserved —
  never reused as "series 4"; always paired with an icon or label, never color alone.
- **One axis.** Never dual y-scales; use two charts or index to a common base.
- Marks: thin bars with 4px rounded data-ends, 2px lines, 2px surface gaps between
  stacked/adjacent fills; recessive grid in `border`-toned hairlines.
- Text in charts wears text tokens (`text-foreground` / `text-muted-foreground`), never
  the series color; a colored swatch beside the label carries identity.
- Legend always present for ≥2 series (≤4 also direct-labeled); single series is named
  by the title. Ship hover tooltips on interactive charts and offer a table view.
- Color follows the entity: filtering series in/out must not repaint the survivors.

## 8. Do / Don't

**Do**

- Build page roots as `space-y-6 p-4 md:p-6` with `PageHeader` at the top.
- Use token utilities for every surface, text, and border: `bg-background`, `bg-card`,
  `text-foreground`, `text-muted-foreground`, `border-border/70`, `bg-muted/50`.
- Use ui/ primitives (`Button`, `Input`, `Select`, `Textarea`, `Card`, `Table`, `Badge`,
  `Alert`, `Dialog`, `Separator`) and shared components (`StatusBadge`, `ListState`, `PanelError`).
- Keep one ember `default` Button per view; everything else `outline`/`secondary`/`ghost`.
- Use the eyebrow-label recipe for labels; `font-mono` for IDs/SKUs/codes.
- Reserve emerald/amber/sky/rose for small semantic accents in the documented recipes.

**Don't** (all of these are real drift we have had to fix — the approval-rules workflow
builder is being remediated for exactly this)

- No hardcoded dark surfaces on pages: `bg-black`, `bg-zinc-900`, `bg-[#0f1115]`-style
  hex surfaces, or any dark panel outside the sidebar. Scrims (`bg-slate-950/45–50`)
  are the only exception.
- No `text-white` / `text-zinc-*` / `text-gray-*` / `text-neutral-*` for UI text — use
  `text-foreground` / `text-muted-foreground` (sidebar text uses sidebar tokens).
- No `border-white/*` or `border-zinc-*` — use `border-border` (usually `/70`) or, in
  the sidebar, `border-sidebar-border`.
- No `rounded-none` sharp corners; nothing in the system is square.
- No raw `<button>` / `<input>` / `<select>` styled ad hoc — use the primitives so focus,
  hover, and disabled states stay consistent.
- No third-party stylesheets (chart libs, editors, flow builders) left unthemed — map
  their CSS variables/props onto our tokens before shipping.
- No literal palette classes for surfaces/text/borders, and no tone colors
  (emerald/amber/rose/sky) promoted beyond small status accents.
- No new fonts, no new shadows outside the scale, no long/looping animations, and no
  removing focus rings.
