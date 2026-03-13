ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "recurring_po_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_orders_recurring_po_id_recurring_pos_id_fk'
  ) THEN
    ALTER TABLE "purchase_orders"
      ADD CONSTRAINT "purchase_orders_recurring_po_id_recurring_pos_id_fk"
      FOREIGN KEY ("recurring_po_id") REFERENCES "recurring_pos"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_recurring_po_id_idx"
  ON "purchase_orders" ("recurring_po_id");
