---
waitsFor:
  - "Fast CI"
conclusion: neutral
---

Auto-approve only after the Fast CI check for the pull request's current head has completed successfully. A queued, in-progress, skipped, cancelled, neutral, or failed Fast CI check is not sufficient. Otherwise, use Macroscope's default approvability criteria.
