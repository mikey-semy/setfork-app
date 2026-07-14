-- Учёт AI-перевода списка (кнопка «Перевести», ADR-0009): отдельное значение
-- feature для aiUsage, чтобы отделить перевод от generate/refine в статистике
-- расхода. Аддитивно; IF NOT EXISTS — идемпотентно на живых БД (db:push).
ALTER TYPE "ai_feature" ADD VALUE IF NOT EXISTS 'translate';
