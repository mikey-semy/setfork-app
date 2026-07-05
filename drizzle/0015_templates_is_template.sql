-- «Use this template»: список-шаблон, копия без fork-связи.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "is_template" boolean DEFAULT false NOT NULL;
