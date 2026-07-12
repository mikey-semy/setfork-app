-- Бэкфилл памяти прохождений: courseCompletions появились в 0032, но история
-- до этого (и прохождения, чьи записи не сработали) не фиксировалась — люди
-- «теряли» сертификат и проходили курс заново. Восстанавливаем из двух
-- независимых источников; идемпотентно (ON CONFLICT DO NOTHING).

-- 1) Из прогонов: у прогона отмечены done ВСЕ шаг-блоки его версии.
--    Берём самый ранний такой прогон пользователя по списку.
INSERT INTO course_completions (template_id, user_id, version, completed_at)
SELECT DISTINCT ON (r.template_id, r.user_id)
  r.template_id,
  r.user_id,
  r.version,
  COALESCE(d.last_done_at, r.updated_at)
FROM runs r
JOIN LATERAL (
  SELECT count(*)::int AS total
  FROM steps s
  WHERE s.version_id = r.version_id AND s.type = 'step'
) t ON t.total > 0
JOIN LATERAL (
  SELECT count(*)::int AS done, max(rss.done_at) AS last_done_at
  FROM run_step_state rss
  WHERE rss.run_id = r.id AND rss.status = 'done'
) d ON d.done >= t.total
ORDER BY r.template_id, r.user_id, COALESCE(d.last_done_at, r.updated_at) ASC
ON CONFLICT (user_id, template_id) DO NOTHING;
--> statement-breakpoint

-- 2) Из тестов: пользователь верно решил ВСЕ quiz-блоки ТЕКУЩЕЙ версии курса.
--    (attempts переживают версии по bid; если автор пересоздал тесты — новые
--    bid не совпадут и бэкфилл честно не сработает.)
INSERT INTO course_completions (template_id, user_id, version, completed_at)
SELECT qa.template_id, qa.user_id, tpl.current_version, max(qa.updated_at)
FROM quiz_attempts qa
JOIN templates tpl ON tpl.id = qa.template_id
JOIN template_versions tv ON tv.template_id = tpl.id AND tv.version = tpl.current_version
JOIN steps s ON s.version_id = tv.id AND s.type = 'quiz' AND s.content->>'bid' = qa.bid
WHERE qa.correct = true
GROUP BY qa.template_id, qa.user_id, tpl.current_version, tv.id
HAVING count(DISTINCT qa.bid) = (
  SELECT count(DISTINCT s2.content->>'bid')
  FROM steps s2
  WHERE s2.version_id = tv.id AND s2.type = 'quiz' AND s2.content->>'bid' IS NOT NULL
)
ON CONFLICT (user_id, template_id) DO NOTHING;
