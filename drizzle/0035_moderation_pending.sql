-- Гейт публикации (модель YouTube): новый публичный список попадает в pending
-- и не виден публике, пока не пройдёт авто-проверку. Существующие списки не трогаем.
ALTER TYPE "moderation_status" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'flagged';
