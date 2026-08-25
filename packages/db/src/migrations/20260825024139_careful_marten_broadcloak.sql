CREATE TABLE "workflow_runtime_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"node_id" varchar(100) NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_runtime_publications" ADD CONSTRAINT "workflow_runtime_publications_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runtime_publications" ADD CONSTRAINT "workflow_runtime_publications_request_org_fk" FOREIGN KEY ("approval_request_id","organization_id") REFERENCES "public"."approval_requests"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runtime_publications_status_idx" ON "workflow_runtime_publications" USING btree ("status","created_at");