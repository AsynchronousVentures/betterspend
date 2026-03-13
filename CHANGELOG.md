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

### Fixed

- Invoice exception resolution path for exemption-tagged invoices.
- Approval queue badge mismatch when no actual approvals were pending.
- Multi-currency migration behavior on databases with schema drift.
- Service worker navigation caching for `/` redirects and unsupported request schemes in the web app.
- Notification dropdown state now reflects new activity since the last view in addition to unread counts.
