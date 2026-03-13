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

### Changed

- `ecosystem.config.example.js` now mirrors the live PM2 process layout and documents log rotation expectations.
- API health checks now report the canonical root application version instead of a fallback constant.

### Fixed

- Invoice exception resolution path for exemption-tagged invoices.
- Approval queue badge mismatch when no actual approvals were pending.
- Multi-currency migration behavior on databases with schema drift.
