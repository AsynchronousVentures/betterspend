# Payment release gate

Status: implemented for the invoice and payment-run paths

## Lifecycle

Invoices move through the payment boundary in three distinct steps:

`approved` -> `ready_for_release` -> `paid`

`PATCH /payment-runs/invoices/:invoiceId/release` performs the first transition
and requires `payments:release`. Creating and submitting a payment run only
accepts `ready_for_release` invoices. Manual invoice payment also requires
`ready_for_release`, so it cannot skip the release decision.

The release transition records `releasedBy` and `releasedAt`, and each release
or release revocation is written to the audit trail. Editing an approved or
released invoice, rematching it, or changing its vendor payment details
reopens the approval path and clears release metadata.

## Release checks

Release requires all of the following at the time of the transition:

- the invoice is approved and has an approval timestamp
- the vendor is active
- vendor onboarding is not pending review or changes requested
- the vendor is not sanctions flagged
- at least one vendor payment account is verified
- no vendor payment account was created or updated after invoice approval

Payment-run submission repeats the same checks inside its transaction. This
keeps a stale release from bypassing a later vendor or account change.

## Toxic pairing

`payments:release` and `vendors:edit_payment_details` are separate permissions.
Built-in administrators do not receive payment release automatically. Role
creation, role updates, and assignments reject the pair for one user, while
access-policy resolution fails closed for legacy data that already contains
both grants. Vendor account routes require the payment-detail permission.

## Integration seams and gaps

The payment-run service owns the release decision and exposes the persisted
release fields for a future provider adapter. Existing manual and virtual-card
payment-run paths consume released invoices. Provider-specific orchestration
and QuickBooks payment write-back remain outside this issue and belong to #64
and #98 follow-up work.

The current vendor model treats `not_started` onboarding as allowed, matching
the existing purchase-order compliance gate. Sanctions screening blocks
`flagged` vendors; the product does not yet define whether `untested` should
be a hard stop. Those policy choices should be made before production use.

This migration is additive and leaves existing invoices without release
metadata unchanged. A production rollout must apply the generated database
migration before serving the release endpoint.
