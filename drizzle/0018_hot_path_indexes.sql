-- Perf: индексы на горячих фильтрах (insights, feed, my-runs, suggestions, fork-count).
CREATE INDEX IF NOT EXISTS "stars_tpl_idx" ON "stars" ("template_id");
CREATE INDEX IF NOT EXISTS "watches_tpl_idx" ON "watches" ("template_id");
CREATE INDEX IF NOT EXISTS "runs_tpl_idx" ON "runs" ("template_id");
CREATE INDEX IF NOT EXISTS "runs_user_idx" ON "runs" ("user_id");
CREATE INDEX IF NOT EXISTS "suggestions_tpl_idx" ON "suggestions" ("template_id","status");
CREATE INDEX IF NOT EXISTS "templates_forked_from_idx" ON "templates" ("forked_from_id");
CREATE INDEX IF NOT EXISTS "template_versions_created_idx" ON "template_versions" ("created_at");
