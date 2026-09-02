import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚠️ ЧАСТОТА СЧИТАЕТСЯ ПО ДВУМ КЛЮЧАМ: НА ЧЕЛОВЕКА И НА СПИСОК.
 *
 * Один ключ на пользователя не спасает список, куда пишут многие; один ключ на список
 * наказывает всех за одного. Форма взята у GitLab — у них лимит независимо на проект и
 * на пользователя.
 *
 * Числа выведены из НАШЕЙ картины (236 списков, один активный человек через агента), а
 * не скопированы. Тест проверяет свойства, а сами величины читает из модуля: иначе он
 * закреплял бы свою копию и остался бы зелёным после их смены.
 */
const calls: { key: string; limit: number }[] = []
let denyMarker = 'нет-такого-ключа'

vi.mock('@/shared/rate-limit', () => ({
  rateLimit: async (key: string, limit: number) => {
    calls.push({ key, limit })
    return { ok: !key.includes(denyMarker), remaining: 0, resetAt: Date.now() + 60_000 }
  },
}))

const { ISSUE_LIMITS, canComment, canOpenIssue } = await import('@/features/issues/limits')

describe('ограничение частоты задач и комментариев', () => {
  beforeEach(() => {
    calls.length = 0
    denyMarker = 'нет-такого-ключа'
  })

  it('считает ДВА ключа: свой у человека и свой у списка', async () => {
    await canOpenIssue('u1', 'l1')
    expect(calls).toHaveLength(2)
    expect(calls.some((c) => c.key.includes('u:u1'))).toBe(true)
    expect(calls.some((c) => c.key.includes('l:l1'))).toBe(true)
  })

  it('переполнение ЛЮБОГО из двух запрещает действие', async () => {
    denyMarker = 'u:u1'
    expect(await canOpenIssue('u1', 'l1')).toBe(false)
    denyMarker = 'l:l1'
    expect(await canOpenIssue('u2', 'l1')).toBe(false)
  })

  it('оба счётчика увеличиваются всегда, а не «пока не откажет»', async () => {
    // Иначе при частых обращениях одного человека счётчик списка отстаёт, и порог по
    // списку не наступает никогда.
    denyMarker = 'u:u1'
    await canOpenIssue('u1', 'l1')
    expect(calls.filter((c) => c.key.includes('l:l1')), 'ключ списка не посчитан').toHaveLength(1)
  })

  it('ключи задач и комментариев не пересекаются: это разные потоки', async () => {
    await canOpenIssue('u1', 'l1')
    const issueKeys = calls.map((c) => c.key)
    calls.length = 0
    await canComment('u1', 'l1')
    expect(calls.map((c) => c.key).some((k) => issueKeys.includes(k))).toBe(false)
  })

  it('порог списка выше личного: иначе один человек исчерпывал бы весь список', () => {
    expect(ISSUE_LIMITS.issuePerList).toBeGreaterThan(ISSUE_LIMITS.issuePerUser)
    expect(ISSUE_LIMITS.commentPerList).toBeGreaterThan(ISSUE_LIMITS.commentPerUser)
  })

  it('личные пороги выше пика агента (десяток подряд), но ниже скрипта в цикле', () => {
    // Агент за заход заводит до десятка задач: порог обязан быть выше, иначе живая
    // работа упирается в отказ. И заметно ниже сотен в минуту, иначе скрипт пройдёт.
    expect(ISSUE_LIMITS.issuePerUser).toBeGreaterThanOrEqual(15)
    expect(ISSUE_LIMITS.issuePerUser).toBeLessThan(100)
    expect(ISSUE_LIMITS.commentPerUser).toBeGreaterThanOrEqual(ISSUE_LIMITS.issuePerUser)
  })
})
