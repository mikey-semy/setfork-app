CREATE TABLE IF NOT EXISTS "discussions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "category" text DEFAULT 'general' NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "discussions_tpl_number" UNIQUE("template_id","number")
);
CREATE INDEX IF NOT EXISTS "discussions_tpl_idx" ON "discussions" ("template_id","created_at");

CREATE TABLE IF NOT EXISTS "discussion_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discussion_id" uuid NOT NULL REFERENCES "discussions"("id") ON DELETE cascade,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "discussion_comments_discussion_idx" ON "discussion_comments" ("discussion_id");
