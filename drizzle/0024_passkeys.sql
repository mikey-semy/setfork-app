CREATE TABLE IF NOT EXISTS "passkeys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "credential_id" text NOT NULL UNIQUE,
  "public_key" text NOT NULL,
  "counter" bigint DEFAULT 0 NOT NULL,
  "transports" text,
  "device_type" text,
  "backed_up" boolean DEFAULT false NOT NULL,
  "name" text DEFAULT 'Passkey' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "passkeys_user_idx" ON "passkeys" ("user_id");
