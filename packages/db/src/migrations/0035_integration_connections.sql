CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_id" uuid,
	"provider" varchar(20) NOT NULL,
	"realm_id" varchar(255) NOT NULL,
	"realm_name" varchar(255),
	"access_token_enc" text,
	"refresh_token_enc" text,
	"access_expires_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"scopes" text,
	"connected_by_user_id" uuid,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_org_provider_unique" ON "integration_connections" USING btree ("organization_id","provider");
--> statement-breakpoint
CREATE INDEX "integration_connections_org_provider_status_idx" ON "integration_connections" USING btree ("organization_id","provider","status");
--> statement-breakpoint
CREATE TABLE "sync_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" varchar(20) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"local_entity" varchar(40) NOT NULL,
	"local_id" uuid NOT NULL,
	"external_entity" varchar(40) NOT NULL,
	"external_id" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"request_id" varchar(50) NOT NULL,
	"doc_number" varchar(100) NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"error_code" varchar(20),
	"error_message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sync_records_org_provider_direction_local_unique" ON "sync_records" USING btree ("organization_id","provider","direction","local_entity","local_id");
--> statement-breakpoint
CREATE INDEX "sync_records_org_provider_status_idx" ON "sync_records" USING btree ("organization_id","provider","status");
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "sync_records" (
	"id", "organization_id", "connection_id", "provider", "direction", "local_entity", "local_id",
	"external_entity", "external_id", "status", "attempts", "request_id", "doc_number",
	"last_attempt_at", "synced_at", "error_message", "payload", "created_at", "updated_at"
)
SELECT
	j."id",
	j."organization_id",
	(
		SELECT c."id"
		FROM "integration_connections" c
		WHERE c."organization_id" = j."organization_id" AND c."provider" = j."target_system"
		ORDER BY c."updated_at" DESC
		LIMIT 1
	),
	j."target_system",
	'outbound',
	'invoice',
	j."invoice_id",
	CASE WHEN j."target_system" = 'qbo' THEN 'Bill' ELSE 'Invoice' END,
	CASE
		WHEN j."external_id" LIKE '%-PENDING-%' OR j."external_id" LIKE '%-SKIPPED-%' THEN NULL
		ELSE j."external_id"
	END,
	CASE
		WHEN j."external_id" LIKE '%-SKIPPED-%' THEN 'skipped'
		WHEN j."status" = 'exported' AND j."external_id" IS NOT NULL
			AND j."external_id" NOT LIKE '%-PENDING-%' AND j."external_id" NOT LIKE '%-SKIPPED-%' THEN 'synced'
		WHEN j."status" = 'failed' THEN 'failed'
		WHEN j."status" = 'skipped' THEN 'skipped'
		ELSE 'pending'
	END,
	j."attempts",
	replace(j."id"::text, '-', ''),
	COALESCE(i."invoice_number", i."internal_number"),
	CASE WHEN j."attempts" > 0 THEN j."updated_at" ELSE NULL END,
	CASE
		WHEN j."status" = 'exported' AND j."external_id" IS NOT NULL
			AND j."external_id" NOT LIKE '%-PENDING-%' AND j."external_id" NOT LIKE '%-SKIPPED-%' THEN j."exported_at"
		ELSE NULL
	END,
	j."error_message",
	j."payload",
	j."created_at",
	j."updated_at"
FROM (
	SELECT DISTINCT ON (j0."organization_id", j0."target_system", j0."invoice_id") j0.*
	FROM "gl_export_jobs" j0
	ORDER BY j0."organization_id", j0."target_system", j0."invoice_id", j0."updated_at" DESC, j0."id" DESC
) j
JOIN "invoices" i ON i."id" = j."invoice_id"
ON CONFLICT ("organization_id", "provider", "direction", "local_entity", "local_id") DO NOTHING;
