import { eq, like } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, proInterest } from '@/shared/db'

/**
 * ЗАМЕР СПРОСА НА PRO: считаем ЛЮДЕЙ, а не нажатия.
 *
 * Порог смены курса назван заранее — 20 заявок (решение 0021). Смысл порога в том,
 * чтобы результат нельзя было истолковать задним числом; но он держится ровно до тех
 * пор, пока одна и та же почта не считается дважды. Иначе двадцать заявок собирает один
 * человек с настойчивой мышью, и решение о платёжке принимается по собственному шуму.
 *
 * Второе свойство — форма отвечает ЗНАЧЕНИЕМ, а не переходом: она стоит внутри
 * сообщения об ограничении, и унести человека со страницы значило бы отобрать у него
 * то, ради чего он сюда пришёл.
 */
vi.mock('@/shared/auth/session', () => ({ getSession: async () => null }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`переход вместо значения: ${to}`)
  },
}))

const form = (email: string, note = '') => {
  const fd = new FormData()
  fd.set('email', email)
  if (note) fd.set('note', note)
  return fd
}

beforeEach(async () => {
  await db.delete(proInterest).where(like(proInterest.email, '%@pi-test.local'))
})

describe('заявка «хочу Pro»', () => {
  it('первая заявка записывается, повторная с той же почты — нет', async () => {
    const { expressProInterest, countProInterest } = await import('@/features/monetization/pro-interest')
    const before = await countProInterest()

    expect(await expressProInterest('list_quota', form('a@pi-test.local'))).toEqual({ ok: true, already: false })
    expect(await expressProInterest('list_quota', form('a@pi-test.local'))).toEqual({ ok: true, already: true })

    const rows = await db.select().from(proInterest).where(eq(proInterest.email, 'a@pi-test.local'))
    expect(rows, 'вторая заявка не создаёт вторую строку').toHaveLength(1)
    expect(await countProInterest()).toBe(before + 1)
  })

  it('почта нормализуется: РЕГИСТР не делает из человека двоих', async () => {
    const { expressProInterest } = await import('@/features/monetization/pro-interest')
    await expressProInterest('list_quota', form('B@pi-test.local'))
    expect(await expressProInterest('list_quota', form('b@PI-TEST.local'))).toEqual({ ok: true, already: true })
  })

  it('негодный адрес — отказ значением, а не переход', async () => {
    const { expressProInterest } = await import('@/features/monetization/pro-interest')
    expect(await expressProInterest('list_quota', form('не почта'))).toEqual({ error: 'bad-email' })
  })

  it('запоминает, у какого ограничения нажали', async () => {
    // Это второй вопрос замера: не «хотят ли платить», а «за что именно».
    const { expressProInterest } = await import('@/features/monetization/pro-interest')
    await expressProInterest('list_quota', form('c@pi-test.local'))
    const [row] = await db.select({ s: proInterest.source }).from(proInterest).where(eq(proInterest.email, 'c@pi-test.local'))
    expect(row.s).toBe('list_quota')
  })
})
