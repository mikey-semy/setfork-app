import 'server-only'
import { and, eq, ilike, or, sql, type Column, type SQL } from 'drizzle-orm'
import { issueComments, issues } from '@/shared/db'
import { likeContains } from '@/shared/db/like'

/**
 * ГДЕ ИСКАТЬ СЛОВА ЗАДАЧИ — ОДНО ПРАВИЛО НА ВСЕ ПОИСКИ.
 *
 * Раньше искали только по заголовку — а суть задачи почти всегда в теле: «не открывается
 * на телефоне» стоит в описании, заголовок при этом «Проблема со списком». Человек ищет
 * слово, которое сам же написал, и не находит своей задачи.
 *
 * Форма взята из Gitea, из её ИСХОДНИКОВ, а не документации
 * (`modules/indexer/issues/db/db.go`, режим без внешнего индексатора):
 *   • `issue.name` — заголовок;
 *   • `issue.content` — тело;
 *   • тело комментариев, через `builder.In("issue.id", … From("comment") …)`, причём
 *     ТОЛЬКО настоящие реплики (`type = CommentTypeComment`), без служебных записей ленты;
 *   • номер — точным равенством, если запрос целиком из цифр.
 * Слова внутри одного поля соединяются И (`buildMatchQuery` → `strings.Fields` → `cond.And`),
 * а сами поля — ИЛИ. То есть «мобила кнопка» найдёт задачу, где оба слова в теле, но не
 * ту, где одно слово в заголовке, а второе в чужом комментарии.
 *
 * ⚠️ У GitLab ИНАЧЕ, и это осознанное расхождение: там ищут только по `title` (вес A) и
 * `description` (вес B) через tsvector (`pg_full_text_searchable` в `app/models/issue.rb`),
 * а реплики вынесены в отдельную область поиска. Мы берём форму Gitea, потому что у нас
 * обсуждение и есть содержание задачи: решение чаще лежит в ответе, чем в описании.
 *
 * ⚠️ КОГДА В ЛЕНТЕ ПОЯВЯТСЯ СЛУЖЕБНЫЕ ЗАПИСИ («закрыл», «закрыто правкой №N»), их надо
 * ИСКЛЮЧИТЬ отсюда, как это делает Gitea своим `type = CommentTypeComment`. Иначе поиск
 * по слову «закрыл» начнёт возвращать все закрытые задачи подряд. Сейчас в
 * `issue_comments` лежат только людские реплики, поэтому условия по виду записи нет.
 */
export function issueKeywordCond(term: string): SQL {
  const words = term.split(/\s+/).filter(Boolean)

  /** Все слова запроса в ОДНОМ поле. */
  const allWordsIn = (col: Column) => and(...words.map((w) => ilike(col, likeContains(w))))!

  const inComments = sql`exists (select 1 from ${issueComments} where ${issueComments.issueId} = ${issues.id} and ${and(
    ...words.map((w) => sql`${issueComments.body} ilike ${likeContains(w)}`),
  )!})`

  const parts: SQL[] = [allWordsIn(issues.title), allWordsIn(issues.body), inComments]
  // Номер ищем, только если весь запрос — цифры: иначе «12abc» поднимал бы задачу №12.
  if (/^\d+$/.test(term)) parts.push(eq(issues.number, Number(term)))
  return or(...parts)!
}
