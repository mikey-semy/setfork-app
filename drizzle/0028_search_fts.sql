-- Поиск: индексы под keyword-поиск (см. features/library/queries.ts searchCondition).
-- pg_trgm — ILIKE-подстроки и опечатки (word_similarity) через GIN;
-- FTS ('simple', без стемминга — контент двуязычный EN/RU) — мультисловные запросы;
-- GIN на tags — фильтр @> (тег-страницы и фильтры ленты).
-- ВАЖНО: выражения индексов должны буквально совпадать с выражениями в queries.ts.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Порог word_similarity для оператора <% (опечатки). Дефолт 0.6 пропускает
-- типовые опечатки («posgres» → 0.55, «боршч» → 0.5); шум при этом ≤ 0.1,
-- так что 0.45 безопасен. На уровне БД — чтобы <% оставался индексным
-- (без SET в каждой сессии). Действует на НОВЫЕ подключения.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.45', current_database());
END $$;

CREATE INDEX IF NOT EXISTS "templates_title_trgm_idx" ON "templates"
  USING gin ((coalesce("title"->>'en','') || ' ' || coalesce("title"->>'ru','')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "templates_desc_trgm_idx" ON "templates"
  USING gin ((coalesce("desc"->>'en','') || ' ' || coalesce("desc"->>'ru','')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "templates_slug_trgm_idx" ON "templates"
  USING gin ("slug" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "templates_tags_idx" ON "templates" USING gin ("tags");

CREATE INDEX IF NOT EXISTS "templates_fts_idx" ON "templates"
  USING gin (to_tsvector('simple',
    (coalesce("title"->>'en','') || ' ' || coalesce("title"->>'ru','')) || ' ' ||
    (coalesce("desc"->>'en','') || ' ' || coalesce("desc"->>'ru','')) || ' ' || "slug"));
