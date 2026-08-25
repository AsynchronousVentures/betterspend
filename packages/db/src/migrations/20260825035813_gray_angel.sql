ALTER TABLE "auth_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "scope" text;--> statement-breakpoint
UPDATE "auth_accounts"
SET "access_token_expires_at" = "expires_at";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "auth_accounts"
		WHERE "provider_id" <> 'credential'
	) THEN
		RAISE EXCEPTION 'Cannot backfill auth account issuers: non-credential providers require an explicit issuer mapping';
	END IF;
END
$$;--> statement-breakpoint
UPDATE "auth_accounts"
SET "issuer" = 'local:credential'
WHERE "provider_id" = 'credential';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "auth_accounts"
		GROUP BY "issuer", "account_id"
		HAVING COUNT(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot create the Better Auth account identity index: duplicate issuer/account_id pairs require manual resolution';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP COLUMN "expires_at";--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_issuer_account_id_unique" ON "auth_accounts" USING btree ("issuer","account_id");
