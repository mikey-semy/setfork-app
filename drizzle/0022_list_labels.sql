CREATE TABLE IF NOT EXISTS "list_labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "color" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "list_labels_tpl_name" UNIQUE("template_id","name")
);
CREATE INDEX IF NOT EXISTS "list_labels_tpl_idx" ON "list_labels" ("template_id");
