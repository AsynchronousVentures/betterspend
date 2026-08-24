# Pull request review policy

Macroscope is the primary automatic reviewer. Its correctness, security, migration-history, and approvability checks run on pull requests. Triage all Macroscope findings before requesting a supplemental review.

CodeRabbit reviews are manual and advisory. Request one `@coderabbitai review` only when the latest candidate changes security boundaries, database migrations, approval behavior, or organization scoping. Do not request it for other changes. A remaining CodeRabbit status or thread does not block CI or merge.

Batch fixes into a coherent push. Request one follow-up CodeRabbit review only when a valid CodeRabbit finding caused a material code change. Do not request another review for unchanged code, comments, formatting, or other non-material fixes.

## Branch protection

Require the stable `Validate` check. It aggregates CI Validation and Review Gate, so both code validation and the required Macroscope checks must pass. CodeRabbit is not a required status check.

When #190 changes the CI job layout, preserve a single stable required aggregator and update this file in the same pull request.
