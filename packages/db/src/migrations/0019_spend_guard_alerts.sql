CREATE TABLE IF NOT EXISTS "spend_guard_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "alert_type" varchar(50) NOT NULL,
  "severity" varchar(20) DEFAULT 'medium' NOT NULL,
  "record_type" varchar(50) NOT NULL,
  "record_id" uuid NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'open' NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_guard_alerts_org_status_idx"
  ON "spend_guard_alerts" ("org_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_guard_alerts_record_idx"
  ON "spend_guard_alerts" ("record_type", "record_id", "alert_type");
