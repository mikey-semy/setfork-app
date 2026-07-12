-- Тумблеры разделов списка («Features», #258): колонки попали в схему,
-- но миграция не была создана — свежая установка (CI полигона, новый стенд)
-- падала на любом insert/select templates. На живых БД колонки уже есть
-- (db:push) — IF NOT EXISTS делает миграцию идемпотентной.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "issues_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "discussions_enabled" boolean DEFAULT true NOT NULL;
