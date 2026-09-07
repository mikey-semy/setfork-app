import 'server-only'
import { rateLimit, underTwoKeyRate } from '@/shared/rate-limit'

/**
 * ОГРАНИЧЕНИЕ ЧАСТОТЫ ДЛЯ ЗАДАЧ И КОММЕНТАРИЕВ.
 *
 * Раньше его не было вовсе: скрипт в цикле мог набить тред за минуту, и каждая запись
 * рассылала бы уведомления автору, владельцу и наблюдателям.
 *
 * ⚠️ СЧИТАЕМ ДВА КЛЮЧА, А НЕ ОДИН — форма взята у GitLab (у них лимит независимо на
 * проект и на пользователя). Один ключ на пользователя не спасает список, куда пишут
 * многие; один ключ на список наказывает всех за одного.
 *
 * ⚠️ ЧИСЛА ВЫВЕДЕНЫ ИЗ НАШЕЙ КАРТИНЫ, А НЕ СКОПИРОВАНЫ. У GitLab это 200 задач и 60
 * комментариев в минуту — их масштаб. У нас 236 списков и один активный человек,
 * который работает через агента: тот за один заход разбирает список и заводит до
 * десятка задач подряд, а на переписку в треде уходит ещё несколько реплик. Отсюда:
 *
 *  • задачи — 20/мин на человека: вдвое выше наблюдаемого пика агента, но скрипт в
 *    цикле (сотни в минуту) режется на первой же секунде;
 *  • комментарии — 40/мин на человека: реплики короче и идут чаще, чем новые задачи;
 *  • на список — втрое от личного (60 и 120): столько дало бы трое одновременно
 *    работающих людей, а сегодня их нет ни одного.
 *
 * Меняя числа, меняйте вместе с причиной: они не «на глаз», а из этой оценки.
 */
export const ISSUE_LIMITS = {
  issuePerUser: 20,
  issuePerList: 60,
  commentPerUser: 40,
  commentPerList: 120,
} as const

const MINUTE = 60_000

/** Разрешено ли действие. `false` — один из двух счётчиков переполнен (см. `underTwoKeyRate`:
 *  форма двух ключей общая с обсуждениями, числа у каждого раздела свои). */
const allowed = (userKey: string, userLimit: number, listKey: string, listLimit: number) =>
  underTwoKeyRate({ key: userKey, limit: userLimit }, { key: listKey, limit: listLimit }, MINUTE)

export function canOpenIssue(userId: string, listId: string): Promise<boolean> {
  return allowed(
    `issue:new:u:${userId}`,
    ISSUE_LIMITS.issuePerUser,
    `issue:new:l:${listId}`,
    ISSUE_LIMITS.issuePerList,
  )
}

/**
 * ЧАСТОТА ДЛЯ СЛУЖЕБНОГО ПИСАТЕЛЯ — ТОЛЬКО ПО СПИСКУ.
 *
 * Личный ключ пасует темп ЧЕЛОВЕКА: он пишет рывками, и двадцать задач подряд — это
 * его пик. У сервисного аккаунта своего темпа нет вовсе — он ходит по расписанию и за
 * один свип может законно завести по задаче в полусотне списков; личный порог обрезал
 * бы такой свип на двадцатом, причём МОЛЧА: тридцать списков остались бы без находки,
 * а в журнале стояло бы «доставлено».
 *
 * Ключ списка при этом остаётся: он и защищает от того, ради чего счётчик заводили —
 * от цикла, бьющего в ОДИН список.
 */
export function canOpenIssueForList(listId: string): Promise<boolean> {
  return rateLimit(`issue:new:l:${listId}`, ISSUE_LIMITS.issuePerList, MINUTE).then((r) => r.ok)
}

export function canComment(userId: string, listId: string): Promise<boolean> {
  return allowed(
    `issue:cmt:u:${userId}`,
    ISSUE_LIMITS.commentPerUser,
    `issue:cmt:l:${listId}`,
    ISSUE_LIMITS.commentPerList,
  )
}
