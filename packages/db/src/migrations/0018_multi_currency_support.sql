ALTER TABLE "organizations" ADD COLUMN "base_currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "base_currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "exchange_rate" numeric(18,8) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "base_total_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "base_allocated_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "base_spent_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "base_currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "exchange_rate" numeric(18,8) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "base_subtotal" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "base_tax_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "base_total_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "exchange_rate" numeric(18,8) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "base_unit_price" numeric(12,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "base_total_price" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "base_currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate" numeric(18,8) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "base_subtotal" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "base_tax_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "base_total_amount" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "exchange_rate" numeric(18,8) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "base_unit_price" numeric(12,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "base_total_price" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
UPDATE "organizations"
SET "base_currency" = COALESCE("settings"->>'currency', 'USD')
WHERE "base_currency" = 'USD';
--> statement-breakpoint
UPDATE "budgets" b
SET
  "base_currency" = o."base_currency",
  "exchange_rate" = CASE WHEN b."currency" = o."base_currency" THEN 1 ELSE 1 END,
  "base_total_amount" = b."total_amount",
  "base_allocated_amount" = b."allocated_amount",
  "base_spent_amount" = b."spent_amount"
FROM "organizations" o
WHERE o."id" = b."organization_id";
--> statement-breakpoint
UPDATE "purchase_orders" po
SET
  "base_currency" = o."base_currency",
  "exchange_rate" = CASE WHEN po."currency" = o."base_currency" THEN 1 ELSE 1 END,
  "base_subtotal" = po."subtotal",
  "base_tax_amount" = po."tax_amount",
  "base_total_amount" = po."total_amount"
FROM "organizations" o
WHERE o."id" = po."organization_id";
--> statement-breakpoint
UPDATE "po_lines" pl
SET
  "exchange_rate" = po."exchange_rate",
  "base_unit_price" = pl."unit_price",
  "base_total_price" = pl."total_price"
FROM "purchase_orders" po
WHERE po."id" = pl."purchase_order_id";
--> statement-breakpoint
UPDATE "invoices" i
SET
  "base_currency" = o."base_currency",
  "exchange_rate" = CASE WHEN i."currency" = o."base_currency" THEN 1 ELSE 1 END,
  "base_subtotal" = i."subtotal",
  "base_tax_amount" = i."tax_amount",
  "base_total_amount" = i."total_amount"
FROM "organizations" o
WHERE o."id" = i."organization_id";
--> statement-breakpoint
UPDATE "invoice_lines" il
SET
  "exchange_rate" = i."exchange_rate",
  "base_unit_price" = il."unit_price",
  "base_total_price" = il."total_price"
FROM "invoices" i
WHERE i."id" = il."invoice_id";
