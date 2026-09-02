import 'server-only'
import { rateLimit } from '@/shared/rate-limit'

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

/** Разрешено ли действие. `false` — один из двух счётчиков переполнен. */
async function allowed(userKey: string, userLimit: number, listKey: string, listLimit: number): Promise<boolean> {
  // Оба счётчика считаем всегда, а не «пока не откажет»: иначе при частых обращениях
  // одного человека счётчик списка отстаёт и порог по списку не наступает никогда.
  const [byUser, byList] = await Promise.all([
    rateLimit(userKey, userLimit, MINUTE),
    rateLimit(listKey, listLimit, MINUTE),
  ])
  return byUser.ok && byList.ok
}

export function canOpenIssue(userId: string, listId: string): Promise<boolean> {
  return allowed(
    `issue:new:u:${userId}`,
    ISSUE_LIMITS.issuePerUser,
    `issue:new:l:${listId}`,
    ISSUE_LIMITS.issuePerList,
  )
}

export function canComment(userId: string, listId: string): Promise<boolean> {
  return allowed(
    `issue:cmt:u:${userId}`,
    ISSUE_LIMITS.commentPerUser,
    `issue:cmt:l:${listId}`,
    ISSUE_LIMITS.commentPerList,
  )
}
