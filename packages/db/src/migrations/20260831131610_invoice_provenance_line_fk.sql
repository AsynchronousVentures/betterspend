ALTER TABLE "invoice_field_provenance" DROP CONSTRAINT "invoice_field_provenance_invoice_line_id_invoice_lines_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_id_invoice_id_unique" ON "invoice_lines" USING btree ("id","invoice_id");
--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_invoice_line_invoice_fk" FOREIGN KEY ("invoice_line_id","invoice_id") REFERENCES "public"."invoice_lines"("id","invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
