-- Кураторские аккаунты библиотеки: их списки — контент сайта, правки
-- ИИ-садовника принимаются автоматически (с атрибуцией и модерацией).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "curated" boolean DEFAULT false NOT NULL;
