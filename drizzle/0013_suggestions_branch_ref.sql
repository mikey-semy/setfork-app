-- A3 (PR-модель): PR = «ветка → main»; items пустые, шаги — из tip ветки.
ALTER TABLE "suggestions" ADD COLUMN IF NOT EXISTS "branch_ref" text;
