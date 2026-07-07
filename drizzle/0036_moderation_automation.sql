-- Автоматизация верификации: отпечаток контента (ловля повторной заливки
-- удалённого), приоритет очереди модерации, апелляция владельца.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "content_fingerprint" text;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "moderation_severity" smallint NOT NULL DEFAULT 0;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "appealed_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "templates_fingerprint_idx" ON "templates" ("content_fingerprint") WHERE "content_fingerprint" IS NOT NULL;
