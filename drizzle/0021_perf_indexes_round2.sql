-- Публичная лента/поиск: сорт по updatedAt / starsCount под фильтром видимости.
-- Частичные индексы точно повторяют visibleFilter (published+public+active).
CREATE INDEX IF NOT EXISTS "templates_pub_updated_idx" ON "templates" ("updated_at" DESC)
  WHERE "status" = 'published' AND "visibility" = 'public' AND "moderation" = 'active';
CREATE INDEX IF NOT EXISTS "templates_pub_stars_idx" ON "templates" ("stars_count" DESC)
  WHERE "status" = 'published' AND "visibility" = 'public' AND "moderation" = 'active';
-- Списки профиля (owner + сорт по updatedAt) и списки каталога (repository_id).
CREATE INDEX IF NOT EXISTS "templates_owner_updated_idx" ON "templates" ("owner_id","updated_at" DESC);
CREATE INDEX IF NOT EXISTS "templates_repository_idx" ON "templates" ("repository_id");
-- Колокол уведомлений: последние N по получателю.
CREATE INDEX IF NOT EXISTS "notifications_recipient_created_idx" ON "notifications" ("recipient_id","created_at" DESC);
-- Вкладка «starred» профиля: звёзды пользователя по времени.
CREATE INDEX IF NOT EXISTS "stars_user_created_idx" ON "stars" ("user_id","created_at" DESC);
