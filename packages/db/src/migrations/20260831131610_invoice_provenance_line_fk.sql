-- Existing databases build this concurrently in migrate.ts before transactional migrations run.
-- This fallback creates it only while bootstrapping an empty database.
DO $$
BEGIN
	IF to_regclass('public.invoice_lines_id_invoice_id_unique') IS NULL THEN
		IF EXISTS (SELECT 1 FROM "invoice_lines" LIMIT 1) THEN
			RAISE EXCEPTION 'invoice_lines is populated; rerun through the migration runner to build the parent key concurrently';
		END IF;
		EXECUTE 'CREATE UNIQUE INDEX "invoice_lines_id_invoice_id_unique" ON "invoice_lines" USING btree ("id","invoice_id")';
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" DROP CONSTRAINT "invoice_field_provenance_invoice_line_id_invoice_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_invoice_line_invoice_fk" FOREIGN KEY ("invoice_line_id","invoice_id") REFERENCES "public"."invoice_lines"("id","invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
