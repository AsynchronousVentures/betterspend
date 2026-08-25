ALTER TABLE "auth_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "scope" text;
