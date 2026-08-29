# Audit hash chain

Every audit entry belongs to exactly one organization chain. The audit-integrity
module appends an entry only inside the caller's transaction. It takes a
transaction-scoped advisory lock for the organization, reads the latest entry,
and stores `prev_hash` plus a SHA-256 `entry_hash` over the versioned row
payload. Verification reads the chain in `(created_at, id)` order and returns
the first broken link in the requested date range.

The hash payload version and canonical JSON rules are private to the module.
Changing them requires a coordinated migration and verifier update. Existing
entries are never reinterpreted silently.

## Migration and rollback

The migration expands the table with nullable hash columns first. The database
migrator then backfills each organization in bounded update batches while
sharing the appender's advisory lock. A short table lock closes the race with
old application writers before `entry_hash` is contracted to `NOT NULL`. The
old application can still be rolled back after the expand step, because it does
not know about or need the new columns.

## Checkpoints and retention

Chains do not rotate automatically in this release. Before retaining or
archiving old entries, an operator should create a checkpoint containing the
organization, the last covered `(created_at, id)`, and that entry's
`entry_hash`. Store the checkpoint in a separately protected system, such as a
write-once object store or an external signing service, and record its object
or signature reference in the compliance evidence package.

The follow-up checkpoint job should run on a fixed cadence (for example, daily
or after a configured number of entries), verify the covered prefix, anchor its
terminal hash, and then archive only complete prefixes. Verification of a
rotated range starts from the trusted checkpoint hash and continues through the
live chain. A checkpoint is an external trust anchor, not a replacement for
the rows it covers, and it must never be accepted from the same mutable audit
table being verified.
