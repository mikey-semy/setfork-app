-- Всё-блочная модель (аддитивно): каждая строка steps становится блоком с type.
-- Дефолт 'step' → все существующие строки мгновенно = шаг-блоки, без потери данных.
ALTER TABLE "steps" ADD COLUMN "type" text DEFAULT 'step' NOT NULL;
ALTER TABLE "steps" ADD COLUMN "content" jsonb DEFAULT '{}'::jsonb NOT NULL;
