-- Реестр тегов (курируемый): источник правды для автокомплита, курирования и
-- админ-CRUD (переименование/слияние/удаление). templates.tags остаётся
-- text[] слагов; здесь — метаданные тега по этому slug'у. usage_count —
-- денормализованный счётчик публичных активных списков с тегом.
-- Идемпотентно (IF NOT EXISTS / ON CONFLICT) — безопасно на живой БД (db:push)
-- и при повторном прогоне migrate.
CREATE TABLE IF NOT EXISTS "tags" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text,
	"description" text,
	"curated" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Бэкфилл: регистрируем ВСЕ существующие теги (по всем спискам), а usage_count
-- считаем только по публичным активным. Пустые строки пропускаем.
INSERT INTO "tags" ("slug", "usage_count")
SELECT tag, count(*) FILTER (
         WHERE t.visibility = 'public' AND t.status = 'published' AND t.moderation = 'active'
       )::int
FROM "templates" t, unnest(t.tags) AS tag
WHERE tag <> ''
GROUP BY tag
ON CONFLICT ("slug") DO NOTHING;
