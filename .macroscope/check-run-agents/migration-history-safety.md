---
title: "Migration history safety"
model: gpt-5-6-sol
reasoning: high
effort: high
input: full_diff
conclusion: failure
include:
  - "packages/db/drizzle/**"
  - "packages/db/src/migrations/**"
tools:
  - browse_code
  - git_tools
  - github_api_read_only
---

## Process

Review only migration-history safety in the included files. Report a finding only when the pull request introduces one of these concrete violations:

- It edits or deletes an existing migration or journal entry instead of adding a new migration.
- A new migration is missing from the migration journal, has a journal order that disagrees with filename order, or reuses an existing journal index or timestamp.
- A schema change that can lock or rewrite a populated table has no staged or otherwise bounded rollout strategy.
- A destructive change drops or irreversibly rewrites production data without an explicit compatibility and recovery plan.

Do not review application correctness, style, generic security, or performance. Finding no violation is the expected result.
