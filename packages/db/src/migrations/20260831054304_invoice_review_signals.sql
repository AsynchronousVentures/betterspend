CREATE TABLE "invoice_field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"field_path" varchar(150) NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_record_id" varchar(255) NOT NULL,
	"source_timestamp" timestamp with time zone,
	"confidence" numeric(5, 4),
	"actor_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"superseded_at" timestamp with time zone,
	"identity_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_field_provenance_source_type_check" CHECK ("invoice_field_provenance"."source_type" IN ('OCR', 'email_intake', 'supplier', 'import', 'PO', 'catalog', 'manual')),
	CONSTRAINT "invoice_field_provenance_field_path_check" CHECK ("invoice_field_provenance"."field_path" IN ('vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'currency', 'exchangeRate', 'subtotal', 'taxAmount', 'totalAmount') OR "invoice_field_provenance"."field_path" ~ '^lines\.[^.]+\.(description|quantity|unitPrice|poLineId|taxCodeId|glAccount)$'),
	CONSTRAINT "invoice_field_provenance_confidence_check" CHECK ("invoice_field_provenance"."confidence" IS NULL OR ("invoice_field_provenance"."confidence" >= 0 AND "invoice_field_provenance"."confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_invoice_org_fk" FOREIGN KEY ("invoice_id","organization_id") REFERENCES "public"."invoices"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_actor_org_fk" FOREIGN KEY ("actor_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_field_provenance_identity_key_unique" ON "invoice_field_provenance" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "invoice_field_provenance_invoice_current_idx" ON "invoice_field_provenance" USING btree ("organization_id","invoice_id","is_current");--> statement-breakpoint
CREATE INDEX "invoice_field_provenance_source_idx" ON "invoice_field_provenance" USING btree ("organization_id","source_type","source_record_id");