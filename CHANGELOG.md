# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.2.0] - 2026-03-13

### Added

- Multi-entity foundation for operating across legal entities.
- Tax code management foundation and settings UI.
- First-pass multi-currency support with exchange rates and base currency management.
- Visual approval workflow builder with raw/visual synchronization.
- Spend guard alerts for duplicate invoices, near-duplicates, split requisitions, and off-hours submissions.
- In-app release version display in Settings and the sidebar footer.
- Release tagging scripts in the root workspace package.
- Supplier catalog price proposal workflows, including buyer review, proposal history, and vendor CSV bulk uploads.
- RFQ response evaluation, award-to-PO flow, and supplier award/rejection notifications.
- Software license detail pages and renewal actions for renew, renegotiate, and cancellation prep.
- Approval workflow simulator with readable approver labels and safe dry-run rule matching.
- Notification center pagination, server-side notification preferences, and bell activity indicators.
- Recurring purchase order schedule controls, history visibility, skip-next, and run-now actions.
- First-pass email intake queue support for manually triaging forwarded quote, invoice, and requisition emails.
- First-pass supplier onboarding questionnaires, portal submission flow, buyer review queue, and PO gating for vendors awaiting onboarding approval.

### Changed

- `ecosystem.config.example.js` now mirrors the live PM2 process layout and documents log rotation expectations.
- API health checks now report the canonical root application version instead of a fallback constant.
- GL integrations now explicitly present QuickBooks and Xero as platform-managed OAuth connections and report whether platform credentials are configured.
- Root PM2 runtime ownership was stabilized under a single daemon after clearing duplicate stale PM2 daemons.
- Began the web design-system migration to Tailwind CSS v4, shadcn/ui-style primitives, Lucide icons, and a new tokenized warm enterprise visual language.
- Reworked auth surfaces, toast, breadcrumbs, document upload UI, and sidebar navigation onto the new frontend foundation while bridging legacy pages through updated palette tokens.
- Refactored the authenticated app shell, search surface, notifications panel, entity switcher, and shortcuts modal onto the new Tailwind-based chrome.
- Migrated the dashboard, approvals queue, vendors, purchase orders, invoices, and requisitions list pages onto reusable Tailwind/shadcn-style page-header, table, select, and status-badge primitives.
- Continued the UI migration across software licenses, notifications, spend guard, and receiving so those operational views now share the new card, form, and filter system.
- Refactored budgets, contracts, and inventory onto the same Tailwind-driven list and forecasting surface patterns, including warning banners, tab filters, and reusable progress treatments.
- Reworked the new vendor, contract, budget, and inventory forms so create flows now use the same Tailwind/shadcn form primitives and card layout as the migrated operational pages.
- Migrated the budget and inventory detail views, including edit states, stock adjustment modal, and budget period management, onto the new design system.
- Migrated the contract detail page, including activation, termination, contract lines, amendments, and document management, onto the new Tailwind-based detail layout.
- Migrated the vendor detail page, including onboarding review, transaction history, portal access, punchout controls, and edit mode, onto the new detail-page system.
- Migrated audit, search, intake, and approval-detail workflow pages onto the new operational UI primitives so internal review tools match the rest of the application.
- Migrated the entities, departments, projects, and users admin CRUD pages onto the Tailwind/shadcn-style form, table, and status-badge system, removing another batch of legacy inline theme usage.
- Migrated GL export jobs, webhooks, and tax code management onto the new admin/settings UI layer while preserving retry, delivery-history, and tax-treatment workflows.
- Migrated GL mappings and its embedded export-job view onto the shared Tailwind/shadcn admin surface so the accounting integration area no longer relies on legacy inline theme styling.
- Migrated the main settings workspace onto the new design system, covering branding, SMTP, approval policy, compliance, integrations, currency controls, and password updates while preserving dirty-state protection.
- Migrated the analytics dashboard onto the new design system, including KPI tiles, chart containers, anomaly panels, department summaries, and the main budget and vendor performance tables.
- Migrated approval delegations onto the new operational UI layer, including delegation setup plus inbound and outbound coverage tables.

### Fixed

- Invoice exception resolution path for exemption-tagged invoices.
- Approval queue badge mismatch when no actual approvals were pending.
- Multi-currency migration behavior on databases with schema drift.
- Service worker navigation caching for `/` redirects and unsupported request schemes in the web app.
- Notification dropdown state now reflects new activity since the last view in addition to unread counts.
