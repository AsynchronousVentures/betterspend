CREATE TABLE IF NOT EXISTS "ai_provider_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "provider" varchar(30) NOT NULL,
  "auth_method" varchar(30) DEFAULT 'api_key' NOT NULL,
  "encrypted_credential" text NOT NULL,
  "credential_hint" varchar(80),
  "default_model" varchar(160) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "status" varchar(30) DEFAULT 'connected' NOT NULL,
  "last_validated_at" timestamp with time zone,
  "last_error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_provider_connections_org_provider_unique" UNIQUE("organization_id", "provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_provider_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "provider" varchar(30) NOT NULL,
  "state" varchar(128) NOT NULL,
  "code_verifier" text NOT NULL,
  "callback_url" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_provider_oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_provider_connections_org_default_idx"
  ON "ai_provider_connections" ("organization_id", "is_default");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_provider_oauth_states_org_provider_idx"
  ON "ai_provider_oauth_states" ("organization_id", "provider");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_connections_org_fk') THEN
    ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_connections_created_by_fk') THEN
    ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_connections_updated_by_fk') THEN
    ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_updated_by_fk"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_oauth_states_org_fk') THEN
    ALTER TABLE "ai_provider_oauth_states" ADD CONSTRAINT "ai_provider_oauth_states_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_oauth_states_created_by_fk') THEN
    ALTER TABLE "ai_provider_oauth_states" ADD CONSTRAINT "ai_provider_oauth_states_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id");
  END IF;
END $$;
