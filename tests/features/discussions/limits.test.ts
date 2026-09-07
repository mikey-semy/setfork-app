import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚠️ ЧАСТОТА ОБСУЖДЕНИЙ СЧИТАЕТСЯ ПО ДВУМ КЛЮЧАМ и двумя потоками.
 *
 * Форма общая с задачами (`underTwoKeyRate`), числа — свои: тред начинают по одному
 * поводу, а отвечают в нём часто, поэтому порог тредов ниже порога реплик. Тест
 * проверяет СВОЙСТВА, а величины читает из модуля: иначе он закреплял бы свою копию и
 * остался бы зелёным после их смены.
 */
const calls: { key: string; limit: number }[] = []
let denyMarker = 'нет-такого-ключа'

// Подменяем хранилище, а не счётчик: правило двух ключей — общее, и подменив его, тест
// проверял бы собственную копию вместо настоящей.
vi.mock('@/shared/rate-limit-store', () => ({
  rateStore: () => ({
    fixedWindow: async (key: string, limit: number) => {
      calls.push({ key, limit })
      return { ok: !key.includes(denyMarker), remaining: 0, retryAfter: 60, resetAt: Date.now() + 60_000 }
    },
  }),
}))

const { DISCUSSION_LIMITS, canOpenDiscussion, canReplyInDiscussion } = await import('@/features/discussions/limits')

beforeEach(() => {
  calls.length = 0
  denyMarker = 'нет-такого-ключа'
})

describe('ограничение частоты обсуждений', () => {
  it('считает ДВА ключа: свой у человека и свой у списка', async () => {
    await canOpenDiscussion('u1', 'l1')
    expect(calls).toHaveLength(2)
    expect(calls.some((c) => c.key.includes('u:u1'))).toBe(true)
    expect(calls.some((c) => c.key.includes('l:l1'))).toBe(true)
  })

  it('переполнение ЛЮБОГО из двух запрещает действие', async () => {
    denyMarker = 'u:u1'
    expect(await canOpenDiscussion('u1', 'l1')).toBe(false)
    denyMarker = 'l:l1'
    expect(await canOpenDiscussion('u2', 'l1')).toBe(false)
  })

  it('оба счётчика увеличиваются всегда, а не «пока не откажет»', async () => {
    denyMarker = 'u:u1'
    await canOpenDiscussion('u1', 'l1')
    expect(calls.filter((c) => c.key.includes('l:l1')), 'ключ списка не посчитан').toHaveLength(1)
  })

  it('треды и реплики — разные потоки: ключи не пересекаются', async () => {
    await canOpenDiscussion('u1', 'l1')
    const threadKeys = calls.map((c) => c.key)
    calls.length = 0
    await canReplyInDiscussion('u1', 'l1')
    expect(calls.map((c) => c.key).some((k) => threadKeys.includes(k))).toBe(false)
  })

  it('⚠️ ключи не пересекаются и с ЗАДАЧАМИ: это разные разделы', async () => {
    // Общий префикс превратил бы два раздела в один поток, и разговор в обсуждениях
    // затыкал бы заведение задач.
    await canOpenDiscussion('u1', 'l1')
    await canReplyInDiscussion('u1', 'l1')
    expect(calls.every((c) => c.key.startsWith('disc:'))).toBe(true)
  })

  it('порог реплик ВЫШЕ порога тредов: в обсуждении переписка и есть содержание', () => {
    expect(DISCUSSION_LIMITS.replyPerUser).toBeGreaterThan(DISCUSSION_LIMITS.threadPerUser)
  })

  it('порог списка втрое от личного: один человек не исчерпывает весь список', () => {
    expect(DISCUSSION_LIMITS.threadPerList).toBeGreaterThan(DISCUSSION_LIMITS.threadPerUser)
    expect(DISCUSSION_LIMITS.replyPerList).toBeGreaterThan(DISCUSSION_LIMITS.replyPerUser)
  })

  it('личный порог выше живого разговора, но ниже скрипта в цикле', () => {
    expect(DISCUSSION_LIMITS.threadPerUser).toBeGreaterThanOrEqual(5)
    expect(DISCUSSION_LIMITS.threadPerUser).toBeLessThan(60)
  })
})
