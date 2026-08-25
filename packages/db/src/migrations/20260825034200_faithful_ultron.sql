SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'budget_commitment_events'::regclass
      AND conname = 'budget_commitment_events_event_type_check_v2'
  ) THEN
    ALTER TABLE "budget_commitment_events" DROP CONSTRAINT "budget_commitment_events_event_type_check";
    ALTER TABLE "budget_commitment_events" RENAME CONSTRAINT "budget_commitment_events_event_type_check_v2" TO "budget_commitment_events_event_type_check";
  ELSE
    ALTER TABLE "budget_commitment_events" DROP CONSTRAINT "budget_commitment_events_event_type_check";
    ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_event_type_check" CHECK ("event_type" in ('requisition_reserved', 'requisition_released', 'purchase_order_committed', 'purchase_order_reduced', 'purchase_order_released', 'invoice_expended', 'invoice_reopened', 'legacy_commitment_backfill', 'legacy_reservation_backfill'));
  END IF;
END $$;
