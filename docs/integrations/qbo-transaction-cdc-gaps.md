# QuickBooks transaction CDC gaps

BetterSpend does not ingest QuickBooks transaction entities in the master-data sync module. `Bill`, `Invoice`, `Payment`, `BillPayment`, and `PurchaseOrder` remain deferred until the connector can recover every active record while reporting deletion uncertainty honestly.

## Why transaction CDC is deferred

QuickBooks Change Data Capture (CDC) accepts a list of entity types and a `changedSince` timestamp. The lookback is limited to 30 days. Intuit documents a maximum of 1,000 returned objects, but does not document a cursor, end timestamp, or paging mechanism for continuing a capped CDC response.

The Query API can page current records with `STARTPOSITION` and `MAXRESULTS`. That is enough to rebuild active transaction rows. It cannot reconstruct records that were deleted during an incomplete CDC interval because those records no longer appear in a current-record query.

Splitting a time interval into smaller CDC requests would not make recovery lossless. CDC has no documented upper time bound, so adjacent requests cannot establish a complete, non-overlapping interval when writes continue during recovery.

This PR therefore limits CDC and webhook processing to the six master-data entities used by BetterSpend mappings: `Account`, `Vendor`, `Class`, `Department`, `Customer`, and `Term`. `TaxCode` and `TaxRate` are synchronized by periodic snapshots because Intuit does not support tax-code changes through CDC.

## Constraints for a future transaction sync

A transaction implementation should keep its own realm-scoped checkpoint and must not advance it as though a capped response were complete. When CDC reaches the cap, the system should:

1. Persist durable evidence that the realm and interval have an unresolved deletion gap.
2. Enqueue one bounded, retained recovery job with deterministic idempotency.
3. Page the Query API to reconcile active transaction rows for the affected interval.
4. Preserve the deletion gap until another authoritative source resolves it.
5. Alert an administrator once per unresolved gap instead of retrying or notifying without a bound.

Webhook delivery can reduce latency, but it cannot prove completeness. Intuit recommends CDC as a backstop for missed webhook events. Queue consumers must validate organization, connection, realm, entity, and operation at runtime before any database or provider action.

## Intuit references

- [Change Data Capture operation](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/changedatacapture)
- [QuickBooks Online API data queries](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries)
- [Best practices for QuickBooks Online webhooks](https://blogs.a.intuit.com/2023/04/18/best-practices-for-using-webhooks-with-quickbooks-online/)
- [QuickBooks Online webhook entities and operations](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/entities-and-operations-supported)
