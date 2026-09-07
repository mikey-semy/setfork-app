import 'server-only'
import { underTwoKeyRate } from '@/shared/rate-limit'

/**
 * ОГРАНИЧЕНИЕ ЧАСТОТЫ ДЛЯ ОБСУЖДЕНИЙ.
 *
 * Раздела не касался ни один счётчик: скрипт в цикле набивал ленту обсуждений за минуту,
 * и каждая запись будет рассылать уведомления, как только они появятся. Форма — та же,
 * что у задач: ДВА ключа, на человека и на список (`underTwoKeyRate`, довод там же).
 *
 * ⚠️ ЧИСЛА ВЫВЕДЕНЫ ИЗ ЭТОГО РАЗДЕЛА, А НЕ СКОПИРОВАНЫ У ЗАДАЧ. Обсуждение и задача
 * различаются тем, как их заводят и как в них пишут:
 *
 *  • НОВЫХ ТРЕДОВ реже, чем задач. Задачу заводят пачкой — агент разбирает список и
 *    сыплет находки; обсуждение начинают по одному поводу, обдумав. Отсюда 10/мин на
 *    человека против 20 у задач: это всё ещё вдвое выше живого пика (пять тредов подряд
 *    не набирается), но скрипт режется сразу.
 *  • РЕПЛИК больше, чем в задаче. В задаче переписка идёт до решения и кончается; в
 *    обсуждении она и есть содержание. Отсюда 40/мин — столько же, сколько у реплик
 *    задачи: выше живого разговора и ниже машинного.
 *  • На список — втрое от личного (30 и 120): столько дало бы трое одновременно
 *    говорящих, а сегодня их нет ни одного.
 *
 * Меняя числа, меняйте вместе с причиной: они не «на глаз», а из этой оценки.
 */
export const DISCUSSION_LIMITS = {
  threadPerUser: 10,
  threadPerList: 30,
  replyPerUser: 40,
  replyPerList: 120,
} as const

const MINUTE = 60_000

/** Можно ли начать тред: свой ключ у человека, свой у списка. */
export function canOpenDiscussion(userId: string, listId: string): Promise<boolean> {
  return underTwoKeyRate(
    { key: `disc:new:u:${userId}`, limit: DISCUSSION_LIMITS.threadPerUser },
    { key: `disc:new:l:${listId}`, limit: DISCUSSION_LIMITS.threadPerList },
    MINUTE,
  )
}

/** Можно ли ответить в треде. Поток отдельный от заведения: реплики идут чаще. */
export function canReplyInDiscussion(userId: string, listId: string): Promise<boolean> {
  return underTwoKeyRate(
    { key: `disc:reply:u:${userId}`, limit: DISCUSSION_LIMITS.replyPerUser },
    { key: `disc:reply:l:${listId}`, limit: DISCUSSION_LIMITS.replyPerList },
    MINUTE,
  )
}
