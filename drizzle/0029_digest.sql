-- Недельный дайджест «сохранённое дорожает» (см. features/digest).
-- Журнал отправок: sent_at последней строки = точка отсчёта следующего письма.
CREATE TABLE IF NOT EXISTS "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"items" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "digests_user_idx" ON "digests" ("user_id","sent_at");
