SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
-- Identity deliberately preserves the existing exact, case-sensitive lookup,
-- including rejected and cancelled invoices. Never delete or rename historical
-- financial records automatically. Resolve duplicate identities before retrying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM invoices
    GROUP BY organization_id, vendor_id, invoice_number
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate vendor invoice identities prevent migration'
      USING HINT = 'Review SELECT organization_id, vendor_id, invoice_number, array_agg(id) FROM invoices GROUP BY organization_id, vendor_id, invoice_number HAVING count(*) > 1; reconcile historical records with finance before retrying. No invoices were changed.';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_vendor_number_unique" ON "invoices" USING btree ("organization_id","vendor_id","invoice_number");