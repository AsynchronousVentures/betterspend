ALTER TABLE "software_licenses" ADD COLUMN "renewal_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
DELETE FROM "sequences"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "organization_id", "entity_type", "year"
        ORDER BY "last_value" DESC, "updated_at" DESC, "id"
      ) AS "duplicate_rank"
    FROM "sequences"
  ) AS "ranked_sequences"
  WHERE "duplicate_rank" > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_org_entity_year_unique"
ON "sequences" USING btree ("organization_id", "entity_type", "year");
