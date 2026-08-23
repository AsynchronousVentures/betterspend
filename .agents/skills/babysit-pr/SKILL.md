---
name: babysit-pr
description: Always active for any pull request workflow. Continuously monitors CI checks, handles review comments, maintains branch rebase status, and resolves bot feedback.
---

# Babysit PR

All repositories have automated checks and AI review bots. They are helpful, even if not always correct.

## Monitoring & Polling
- If the harness provides native PR monitoring tools, use them to respond in real time.
- Otherwise, periodically poll the PR for new comments, reviews, and CI status checks.

## Handling Findings & CI
- Only evaluate comments and CI checks created after the latest push.
- Verify every bot finding against the actual source code before modifying anything.
- Fix genuine issues and CI test failures.
- Distinguish between true repository failures and infrastructure flakes (rerun flakes, fix bugs).

## Branch & Conflict Management
- Monitor changes to `main` (or the target branch) and rebase when needed.
- If an overlapping PR renders this PR obsolete:
  - Stop monitoring.
  - Report the situation to the user.
  - Ask before closing the PR unless closure was explicitly pre-authorized.

## Dismissals & Responses
- If a review bot leaves feedback not worth addressing or contains a false positive, reply with a written justification and resolve the comment.
