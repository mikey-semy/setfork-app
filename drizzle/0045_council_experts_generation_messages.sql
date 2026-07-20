-- Догоняем прод: council_experts и generation_messages есть в схеме и в dev-БД, но
-- версионной миграции под них не было НИ ОДНОЙ. Их накатывали локально через `db:push`,
-- а деплой применяет только `drizzle-kit migrate` — поэтому на проде таблиц не появилось:
--   /admin падал с `relation "council_experts" does not exist` (42P01),
--   а generation_messages — это история чата генерации.
--
-- DDL снят с dev-БД (pg_dump), чтобы совпадал со схемой один в один.
-- Всё идемпотентно: там, где таблицы уже есть (dev), миграция ничего не делает.

CREATE TABLE IF NOT EXISTS "council_experts" (
  "id" text PRIMARY KEY NOT NULL,
  "name_en" text NOT NULL,
  "name_ru" text NOT NULL,
  "persona" text NOT NULL,
  "domains" text[] DEFAULT '{}'::text[] NOT NULL,
  "model" text DEFAULT ''::text NOT NULL,
  "avatar" text DEFAULT ''::text NOT NULL,
  "avatar_uploaded" boolean DEFAULT false NOT NULL,
  "online" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "council_experts_sort_idx" ON "council_experts" USING btree ("enabled", "sort");

CREATE TABLE IF NOT EXISTS "generation_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "generation_id" uuid NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "kind" text NOT NULL,
  "who" text,
  "name" text,
  "text" text DEFAULT ''::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "generation_messages_gen_idx" ON "generation_messages" USING btree ("generation_id", "created_at");

-- FK отдельно и под guard: ADD CONSTRAINT не умеет IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE "generation_messages"
    ADD CONSTRAINT "generation_messages_generation_id_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
