CREATE TABLE "workflow_definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph_json" jsonb NOT NULL,
	"positions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"executable_json" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_id" uuid,
	"domain" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"current_draft" jsonb NOT NULL,
	"published_version_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "definition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "current_node_id" varchar(100);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entities_id_organization_id_unique" ON "legal_entities" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definition_versions_id_organization_id_unique" ON "workflow_definition_versions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_id_organization_id_unique" ON "workflow_definitions" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_definition_org_fk" FOREIGN KEY ("definition_id","organization_id") REFERENCES "public"."workflow_definitions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_published_by_org_fk" FOREIGN KEY ("published_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_entity_org_fk" FOREIGN KEY ("entity_id","organization_id") REFERENCES "public"."legal_entities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_org_fk" FOREIGN KEY ("created_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_updated_by_org_fk" FOREIGN KEY ("updated_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_published_version_org_fk" FOREIGN KEY ("published_version_id","organization_id") REFERENCES "public"."workflow_definition_versions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definition_versions_definition_version_unique" ON "workflow_definition_versions" USING btree ("definition_id","version");--> statement-breakpoint
CREATE INDEX "workflow_definition_versions_definition_idx" ON "workflow_definition_versions" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "workflow_definitions_org_domain_idx" ON "workflow_definitions" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "workflow_definitions_entity_idx" ON "workflow_definitions" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_definition_version_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."workflow_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_workflow_definition_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'workflow definition versions are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER workflow_definition_versions_immutable
BEFORE UPDATE OR DELETE ON workflow_definition_versions
FOR EACH ROW
EXECUTE FUNCTION reject_workflow_definition_version_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_workflow_definition_published_version_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM workflow_definition_versions version
		WHERE version.id = NEW.published_version_id
			AND version.definition_id = NEW.id
	) THEN
		RAISE EXCEPTION 'published version must belong to its workflow definition';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER workflow_definitions_published_version_owner
BEFORE INSERT OR UPDATE OF published_version_id ON workflow_definitions
FOR EACH ROW
EXECUTE FUNCTION enforce_workflow_definition_published_version_owner();
