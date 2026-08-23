ALTER TABLE "catalog_price_proposals" ADD COLUMN "applied_at" timestamp with time zone;
--> statement-breakpoint
-- Proposals approved before this column existed were applied at review time;
-- backfill so the due-price sweep never replays historical approvals over
-- newer catalog prices.
UPDATE "catalog_price_proposals"
SET "applied_at" = COALESCE("reviewed_at", "submitted_at")
WHERE "status" = 'approved';
