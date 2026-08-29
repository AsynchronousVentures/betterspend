CREATE TABLE "external_entity_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" varchar(20) NOT NULL,
	"external_entity" varchar(40) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"sync_token" varchar(100),
	"local_entity" varchar(40) NOT NULL,
	"local_id" uuid,
	"direction" varchar(10) DEFAULT 'inbound' NOT NULL,
	"auto_created" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"merged_into_external_id" varchar(255),
	"payload" jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_entity_mappings_direction_check" CHECK ("external_entity_mappings"."direction" in ('inbound', 'outbound'))
);
--> statement-breakpoint
ALTER TABLE "external_entity_mappings" ADD CONSTRAINT "external_entity_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_entity_mappings" ADD CONSTRAINT "external_entity_mappings_connection_org_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."integration_connections"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_entity_mappings_external_identity_unique" ON "external_entity_mappings" USING btree ("organization_id","provider","direction","external_entity","external_id");--> statement-breakpoint
CREATE INDEX "external_entity_mappings_local_lookup_idx" ON "external_entity_mappings" USING btree ("organization_id","provider","local_entity","local_id");--> statement-breakpoint
CREATE INDEX "external_entity_mappings_catalog_lookup_idx" ON "external_entity_mappings" USING btree ("organization_id","provider","external_entity","is_deleted","display_name");