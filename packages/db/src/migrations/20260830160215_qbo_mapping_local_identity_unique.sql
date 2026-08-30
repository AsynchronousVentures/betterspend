DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "external_entity_mappings"
		WHERE "local_id" IS NOT NULL
			AND "is_active" = true
			AND "is_deleted" = false
		GROUP BY "organization_id", "provider", "direction", "local_entity", "local_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot enforce linked local mapping uniqueness: duplicate active links exist. Resolve them explicitly before retrying this migration.';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "external_entity_mappings_linked_local_identity_unique" ON "external_entity_mappings" USING btree ("organization_id","provider","direction","local_entity","local_id") WHERE "external_entity_mappings"."local_id" is not null and "external_entity_mappings"."is_active" = true and "external_entity_mappings"."is_deleted" = false;
