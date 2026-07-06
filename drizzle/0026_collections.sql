CREATE TABLE IF NOT EXISTS "collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "title" jsonb NOT NULL,
  "desc" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cover_image" text,
  "accent" text,
  "curator_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "published" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "collection_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "collection_id" uuid NOT NULL REFERENCES "collections"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "collection_items_uq" UNIQUE("collection_id","kind","ref_id")
);
CREATE INDEX IF NOT EXISTS "collection_items_coll_idx" ON "collection_items" ("collection_id","position");
