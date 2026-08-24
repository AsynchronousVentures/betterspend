# Database migrations

Each developer or agent must use an isolated, disposable PostgreSQL database. Do not point a feature branch at a shared development database.

## Author a schema change

1. Change the schema files in `packages/db/src/schema/`.
2. Build the shared package with `pnpm --filter @betterspend/shared build`.
3. Generate the migration with `pnpm --filter @betterspend/db db:generate --name <short_description>`.
4. Review the generated SQL. Do not hand-edit the journal or snapshot.
5. Commit the SQL file, `_journal.json`, and snapshot as one indivisible change.
6. Run `pnpm --filter @betterspend/db db:validate-history`.
7. Apply the full history to an empty database, seed it, and run the database checks.

Concurrent migrations can conflict in their filename, journal entry, or snapshot. Resolve them by regenerating the new migration on top of the combined history. Never renumber, merge, or silently rewrite migrations in CI.

Committed migration SQL is immutable and forward-only. If an applied migration is wrong, add a new migration. Editing an applied migration requires a documented recovery change that explains the affected environments and preserves a working path for both fresh and existing databases.

## Resolve a migration conflict

Keep the migrations already present on the target branch. Remove only your branch's generated SQL, journal entry, and snapshot, then regenerate your schema change from the combined history. Review the regenerated SQL before committing it. Do not resolve a journal conflict by retaining both entries without regenerating the matching snapshot.

## Make a breaking change

Use expand-migrate-contract across separate deployments:

1. Expand with a backward-compatible schema change.
2. Deploy code that works with both old and new shapes.
3. Migrate existing data in a forward-only migration or resumable job.
4. Remove the old shape in a later migration after all running code has moved off it.

Application rollback only changes container images. It does not reverse database migrations, so every intermediate schema must remain compatible with the application versions that may run during deployment or rollback.

## Recover migration history

Stop and inspect the SQL files, journal, snapshots, and the `drizzle.__drizzle_migrations` rows in each persistent environment. Write down which migrations were applied before changing metadata. Prefer a new metadata-only canonical snapshot over changing SQL that may already have run. Validate both an empty database and a copy of the affected persistent database before deployment.

The recovery at migration `0037_canonicalize_migration_metadata` repaired a branched snapshot parent, restored monotonic journal timestamps, and recorded the schema produced by migrations `0000` through `0036`. Its SQL is intentionally a no-op because those schema changes remain owned by their original migrations.

## Production execution

`deploy/deploy.sh` is the production migration path. It takes a backup and runs the one-shot migrator before starting new application containers. Do not run an out-of-band migrator while a deployment is active.
