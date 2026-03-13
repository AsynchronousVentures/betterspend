-- AP Aging: Add payment fields to invoices and create payment_runs tables

ALTER TABLE "invoices" ADD COLUMN "payment_terms" varchar(20);
ALTER TABLE "invoices" ADD COLUMN "early_payment_discount_percent" numeric(5,2);
ALTER TABLE "invoices" ADD COLUMN "early_payment_discount_by" date;
ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp with time zone;
ALTER TABLE "invoices" ADD COLUMN "payment_reference" varchar(255);

CREATE TABLE "payment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"total_amount" numeric(15,4),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payment_run_invoices" (
	"payment_run_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL
);

ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_run_invoices" ADD CONSTRAINT "payment_run_invoices_payment_run_id_payment_runs_id_fk" FOREIGN KEY ("payment_run_id") REFERENCES "public"."payment_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_run_invoices" ADD CONSTRAINT "payment_run_invoices_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
