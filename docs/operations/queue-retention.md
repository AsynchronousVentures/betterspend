# OCR and GL queue retention

PostgreSQL `ocr_jobs` and `sync_records` remain the authoritative result and status history. BullMQ retains up to 1,000 completed jobs for one day and up to 1,000 terminally failed jobs for seven days in each OCR and GL export queue. The limits apply to initial enqueue and manual retry paths. Automatic retry attempts still run before failed-job retention applies.

BullMQ prunes lazily when another job finishes. A retained job ID still deduplicates enqueue attempts; after removal the ID can be reused. GL export's PostgreSQL sync checks remain responsible for preventing an already-synced export from being sent again.

For jobs retained before this policy, run a bounded cleanup pass with the intended Redis connection configuration supplied to the process:

```sh
pnpm --filter @betterspend/api exec tsx src/common/queue/clean-terminal-jobs.ts ocr
pnpm --filter @betterspend/api exec tsx src/common/queue/clean-terminal-jobs.ts gl-export
```

Each invocation removes at most 1,000 expired completed jobs and 1,000 expired failed jobs, using the same age limits. Repeat when the returned count reaches 1,000. Waiting, active, delayed, and recent terminal jobs are untouched. This cleanup does not change PostgreSQL records.

Run the Redis regression against an isolated test instance with `REDIS_TEST_URL` set:

```sh
pnpm --filter @betterspend/api exec tsx --test src/common/queue/terminal-job-retention.redis.test.ts
```
