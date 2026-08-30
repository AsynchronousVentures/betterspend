ALTER TABLE "external_entity_mappings" ADD COLUMN "local_key" varchar(255);--> statement-breakpoint
ALTER TABLE "external_entity_mappings" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Expand only: defer validation and build the lookup index concurrently after the migration transaction.
ALTER TABLE "external_entity_mappings" ADD CONSTRAINT "external_entity_mappings_default_shape_check" CHECK ("external_entity_mappings"."is_default" = false or ("external_entity_mappings"."local_id" is null and "external_entity_mappings"."local_key" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "external_entity_mappings" ADD CONSTRAINT "external_entity_mappings_local_identity_shape_check" CHECK ("external_entity_mappings"."local_id" is null or "external_entity_mappings"."local_key" is null) NOT VALID;
