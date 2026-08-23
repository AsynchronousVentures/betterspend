ALTER TABLE "software_licenses" ADD COLUMN "renewal_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;
