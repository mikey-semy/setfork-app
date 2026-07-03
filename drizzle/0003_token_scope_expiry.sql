ALTER TABLE "api_tokens" ADD COLUMN "scope" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "expires_at" timestamp with time zone;