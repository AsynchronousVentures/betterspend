CREATE TABLE "tax_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "code" varchar(20) NOT NULL,
  "rate_percent" numeric(5,2) DEFAULT '0' NOT NULL,
  "tax_type" varchar(20) NOT NULL,
  "is_recoverable" boolean DEFAULT true NOT NULL,
  "gl_account_code" varchar(50),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tax_codes_org_code_unique" UNIQUE("org_id", "code")
);
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "tax_code_id" uuid;
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "tax_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "tax_inclusive" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "tax_code_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "tax_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "tax_inclusive" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_codes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_codes"("id") ON DELETE no action ON UPDATE no action;
