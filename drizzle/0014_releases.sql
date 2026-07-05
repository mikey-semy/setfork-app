-- Releases: осознанная публикация версии (тег, заголовок, notes-markdown).
CREATE TABLE IF NOT EXISTS "releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "tag" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "releases_tpl_tag" UNIQUE("template_id","tag")
);
CREATE INDEX IF NOT EXISTS "releases_tpl_idx" ON "releases" ("template_id","created_at");
