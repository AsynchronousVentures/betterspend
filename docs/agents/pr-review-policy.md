# Pull request review policy

Run `pnpm ci:preflight` locally before the first push. Use `pnpm ci:preflight:docker` to check production images explicitly. The shared pre-push hook automatically selects the Docker tier when Dockerfiles, workspace package manifests, the lockfile, Compose files, or deployment packaging changed.

Open agent-authored pull requests as drafts. Fast CI runs before external review. Documentation and agent-metadata-only changes take a cheap Fast CI path; workflow, packaging, dependency, script, source, and unknown changes run the full local preflight. After Fast CI passes on the latest head, the watching agent must run `gh pr ready <PR URL>`. Leave a failing PR as a draft and fix it before promotion. Macroscope then reviews the verified candidate.

Macroscope is the primary reviewer. Its correctness, security, migration-history, and approvability checks run automatically after promotion. Approvability supplies the required approval for routine changes. If Macroscope withholds approval, a human reviewer decides whether to approve. Triage every Macroscope finding.

After verifying a Macroscope review comment, react with 👍 when the finding is useful and correct or 👎 when it is incorrect or unhelpful. Do not react before checking the claim against the code. Macroscope uses these reactions to learn review preferences. See [Macroscope code review](https://docs.macroscope.com/bug-detection-and-fixes).

CodeRabbit is supplemental, manual, and advisory. Request one review only when the latest candidate changes security boundaries, database migrations, approval behavior, or organization scoping, and only after Macroscope findings are triaged. Its status and unresolved threads do not block CI or merge.

CodeRabbit learns from direct natural-language replies, not a documented reaction workflow. When a CodeRabbit correction reflects a lasting repository preference, reply to the specific comment, mention `@coderabbitai`, and explain why the preference exists. Do not create a learning for a one-off exception. Confirm that CodeRabbit reports the learning before relying on it. See [CodeRabbit learnings](https://docs.coderabbit.ai/knowledge-base/learnings).

Batch review fixes into a coherent push. Request one follow-up CodeRabbit review only when a valid finding caused a material code change. Avoid follow-up reviews for unchanged code, comments, formatting, or other non-material fixes.

Before pushing material fixes to a ready pull request, convert it back to draft. Let the current Fast CI run finish unless the next push fixes a known failure; superseding an active run discards Blacksmith work.

## Branch protection

Require the stable `Validate` check, one approving review, and resolved review threads. `Validate` reports the event's CI result and stays present when non-runtime changes intentionally skip Full CI, including in the merge queue. Non-runtime pushes to `main` stop after validation and do not publish images. GitHub's native review rule accepts an approval from Macroscope Approvability or a human reviewer. CodeRabbit is not a required status check or reviewer.
