CREATE TABLE "legal_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "code" varchar(50) NOT NULL,
  "currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "gl_account_prefix" varchar(50),
  "address" jsonb DEFAULT '{}'::jsonb,
  "tax_id" varchar(100),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "legal_entities_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "legal_entities" ("id", "organization_id", "name", "code", "currency", "address", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  o."id",
  o."name" || ' Main',
  UPPER(LEFT(REGEXP_REPLACE(o."slug", '[^A-Za-z0-9]', '', 'g') || 'MAIN', 12)),
  COALESCE(o."settings"->>'currency', 'USD'),
  '{}'::jsonb,
  now(),
  now()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1
  FROM "legal_entities" le
  WHERE le."organization_id" = o."id"
);
--> statement-breakpoint
UPDATE "vendors" v
SET "entity_id" = le."id"
FROM "legal_entities" le
WHERE le."organization_id" = v."organization_id"
  AND le."is_active" = true
  AND v."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "budgets" b
SET "entity_id" = le."id"
FROM "legal_entities" le
WHERE le."organization_id" = b."organization_id"
  AND le."is_active" = true
  AND b."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "purchase_orders" po
SET "entity_id" = le."id"
FROM "legal_entities" le
WHERE le."organization_id" = po."organization_id"
  AND le."is_active" = true
  AND po."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "invoices" i
SET "entity_id" = le."id"
FROM "legal_entities" le
WHERE le."organization_id" = i."organization_id"
  AND le."is_active" = true
  AND i."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "approval_rules" ar
SET "entity_id" = le."id"
FROM "legal_entities" le
WHERE le."organization_id" = ar."organization_id"
  AND le."is_active" = true
  AND ar."entity_id" IS NULL;
