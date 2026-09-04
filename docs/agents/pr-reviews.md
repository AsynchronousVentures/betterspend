# Pull request reviews

## Review sources

This repository uses:

- independent agent review when warranted
- CodeRabbit as an automated advisory review source
- Macroscope as an automated advisory review source

CodeRabbit and Macroscope are advisory, non-blocking review sources unless another repository instruction explicitly says otherwise. Do not wait or poll indefinitely for either before making progress.

However, new actionable CodeRabbit or Macroscope findings must be evaluated before merge.

## Findings

Verify every substantive finding against:

- the current PR head
- the actual code
- applicable specs and acceptance criteria
- durable repository documentation

Classify findings as:

- must fix
- follow-up
- false positive
- superseded by later code
- informational or nit

Do not fix code merely to satisfy an incorrect automated comment.

Real behavioral, security, authorization, concurrency, data-integrity, or acceptance-criteria defects remain actionable regardless of who found them.

## New commits and later reviews

A review applies to the code that existed when it was performed.

Do not treat a previous successful independent review as permanent approval of later commits.

Likewise, a later CodeRabbit or Macroscope finding must still be evaluated even when an earlier agent review approved the PR.

## Review rounds

For a valid must-fix finding:

1. Route the fix back to the owning implementation lane when practical.
2. Run focused verification.
3. Push the corrected head.
4. Re-check CI and current review state.
5. Verify that the finding is resolved.

Avoid endless fix/re-review loops for stylistic or preference-only findings.

## Merge readiness

Before declaring a PR ready to merge, verify:

- required CI is green
- relevant tests and checks pass
- no unresolved must-fix findings remain
- acceptance criteria are satisfied
- the branch is mergeable against the current base
- migration ordering and cross-PR assumptions are still valid where applicable

CodeRabbit and Macroscope do not need to finish or approve before merge when repository policy otherwise permits merging.

## Monitoring

When Tyler explicitly asks to watch or babysit a PR, monitor for:

- new commits
- CI state changes
- new CodeRabbit reviews or comments
- new Macroscope reviews or comments
- new human review comments
- merge conflicts or base-branch drift

Only surface or dispatch work for meaningful changes. Do not wake expensive workers for nits unless repository policy requires them.

## BetterSpend review workflow

Run `pnpm ci:preflight` locally before the first push. Use `pnpm ci:preflight:docker` to check production images explicitly. The shared pre-push hook automatically selects the Docker tier when Dockerfiles, workspace package manifests, the lockfile, Compose files, or deployment packaging changed.

Open agent-authored pull requests as drafts. Fast CI runs before external review. Documentation and agent-metadata-only changes take a cheap Fast CI path; workflow, packaging, dependency, script, source, and unknown changes run the full local preflight. After Fast CI passes on the latest head, the watching agent must run `gh pr ready <PR URL>`. Leave a failing PR as a draft and fix it before promotion. Macroscope then reviews the verified candidate.

Macroscope is the primary advisory reviewer. Its correctness, security, migration-history, and approvability checks run automatically after promotion. Approvability is useful evidence for low-risk PRs, but it is not a required merge gate. `Eligibility: Not approved` alone does not block merge when required CI, correctness and review findings, threads, acceptance criteria, and merge-queue requirements are clean. Triage every Macroscope finding.

After verifying a Macroscope review comment, react with 👍 when the finding is useful and correct or 👎 when it is incorrect or unhelpful. Do not react before checking the claim against the code. Macroscope uses these reactions to learn review preferences. See [Macroscope code review](https://docs.macroscope.com/bug-detection-and-fixes).

CodeRabbit is supplemental and manual. Request one review only when the latest candidate changes security boundaries, database migrations, approval behavior, or organization scoping, and only after Macroscope findings are triaged. Its status is not a required check or reviewer gate, but substantive findings must be triaged and its review threads must be resolved before merge.

CodeRabbit learns from direct natural-language replies, not a documented reaction workflow. When a CodeRabbit correction reflects a lasting repository preference, reply to the specific comment, mention `@coderabbitai`, and explain why the preference exists. Do not create a learning for a one-off exception. Confirm that CodeRabbit reports the learning before relying on it. See [CodeRabbit learnings](https://docs.coderabbit.ai/knowledge-base/learnings).

Batch review fixes into a coherent push. Request one follow-up CodeRabbit review only when a valid finding caused a material code change. Avoid follow-up reviews for unchanged code, comments, formatting, or other non-material fixes.

Before pushing material fixes to a ready pull request, convert it back to draft. Let the current Fast CI run finish unless the next push fixes a known failure; superseding an active run discards CI work.

Every review comment on a PR you opened must receive a reply before merge. Each reply either states the commit that addressed it, or states that it is being ignored and why. Use `@coderabbitai resolve` or resolve threads through the API once a CodeRabbit comment has been addressed.

Do not merge a PR while a Macroscope correctness or security finding, a `CHANGES_REQUESTED` review, or another verified must-fix finding remains outstanding, even if required checks are green. Resolve the issue and its thread, or explicitly dismiss a false-positive or superseded thread first. Surface unresolved feedback to Tyler before merging rather than after.

Do not manufacture self-approval on maintainer-authored PRs. External-contributor PRs require human maintainer review before merge. Maintainer- and agent-authored PRs may proceed without a native GitHub approval when all enforced repository gates, review requirements, and acceptance criteria are satisfied.

## Branch protection

The enforced GitHub gates are the stable `Validate` check, resolved review threads, and the merge queue. Merge BetterSpend PRs through the merge queue as squash merges, never by bypassing it. `Validate` reports the event's CI result and stays present when non-runtime changes intentionally skip Full CI, including in the merge queue. Non-runtime pushes to `main` stop after validation and do not publish images. GitHub requires zero approving reviews and has no bypass actors. CodeRabbit and Macroscope are advisory review sources, not required status checks or native reviewer gates.
