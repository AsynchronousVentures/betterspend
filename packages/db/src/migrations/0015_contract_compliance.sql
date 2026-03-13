ALTER TABLE "po_lines" ADD COLUMN "contract_compliance_status" varchar(20);--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "contract_compliance_delta_percent" numeric(8,4);--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "matched_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "contracted_unit_price" numeric(15,4);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_matched_contract_id_contracts_id_fk" FOREIGN KEY ("matched_contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
