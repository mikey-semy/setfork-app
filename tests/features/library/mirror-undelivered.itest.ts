import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Неудача, о которой ЯДРО НЕ УЗНАЛО — на настоящей Postgres.
 *
 * Обычно статус зеркала пишет ядро: оно одно видит исход `git push`. Но когда до
 * ядра не дошло вовсе (лежит, истёк дедлайн вызова), писать некому — и это не
 * теоретический случай, а два разных провала сразу:
 *
 *  * «настроил зеркало при лежащем ядре» — `saveMirror` перед пушем обнуляет
 *    ошибку, подметальщик берёт только строки с ошибкой, и зеркало не
 *    синхронизируется НИКОГДА, молча;
 *  * «авария ядра» — без счётчика неудач пауза не растёт, и повторы идут с
 *    минимальным интервалом всё время аварии.
 *
 * Оба лечатся одной записью внутри `pushListMirror`. Здесь проверяется, что она
 * происходит — и что она НЕ происходит, когда ядро всё-таки ответило.
 */

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))

/** Что сделает «ядро» на следующий вызов. */
let behave: () => Promise<{ ok: boolean; error: string }> = async () => ({ ok: true, error: '' })
vi.mock('@/features/git/core', () => ({ gitCore: { mirrorPush: () => behave() } }))

const { db, users, templates } = await import('@/shared/db')
const { pushListMirror } = await import('@/features/library/mirror-push')

let ownerId = ''

const row = async () => (await db.select().from(templates).where(eq(templates.slug, 'mirrored')))[0]

beforeEach(async () => {
  behave = async () => ({ ok: true, error: '' })
  await resetTables([users, templates])
  const [u] = await db.insert(users).values({ handle: 'owner' }).returning({ id: users.id })
  ownerId = u.id
  await db.insert(templates).values({
    ownerId,
    slug: 'mirrored',
    title: { en: 'Mirrored' },
    mirrorUrl: 'https://github.com/o/r',
    mirrorToken: 'enc',
    mirrorError: null,
    mirrorAttempts: 0,
    mirrorSyncedAt: null,
  })
})

describe('пуш, не дошедший до ядра', () => {
  it('записывает неудачу сам — иначе зеркало не попадёт в повторы вовсе', async () => {
    behave = async () => {
      throw new Error('ECONNREFUSED')
    }
    const res = await pushListMirror('owner', 'mirrored')
    expect(res.delivered).toBe(false)
    const t = await row()
    expect(t.mirrorError).toBeTruthy() // без ошибки подметальщик строку не увидит
    expect(t.mirrorAttempts).toBe(1) // без счётчика пауза не растёт
    expect(t.mirrorSyncedAt).not.toBeNull()
  })

  it('НЕ трогает строку, если ядро ответило: там счёт ведёт оно', async () => {
    behave = async () => ({ ok: false, error: '403 Forbidden' })
    await pushListMirror('owner', 'mirrored')
    const t = await row()
    expect(t.mirrorAttempts).toBe(0) // ядро в этом тесте замокано и не писало
  })

  it('не считает дважды, когда ядро успело записать, а ответ потерялся', async () => {
    // Самый неприятный случай: `delivered:false` означает «мы не получили
    // ответ», а не «ядро не получило запрос». Ядро всё сделало и записало
    // неудачу — а ответ не доехал. Второй счёт прогнал бы зеркало по лестнице
    // пауз вдвое быстрее обещанного.
    behave = async () => {
      await db
        .update(templates)
        .set({ mirrorError: 'boom', mirrorAttempts: 1, mirrorSyncedAt: new Date() })
        .where(eq(templates.slug, 'mirrored'))
      throw new Error('deadline exceeded')
    }
    await pushListMirror('owner', 'mirrored')
    expect((await row()).mirrorAttempts).toBe(1)
  })

  it('чужой список не задет', async () => {
    await db.insert(templates).values({
      ownerId,
      slug: 'other',
      title: { en: 'Other' },
      mirrorUrl: 'https://github.com/o/other',
      mirrorToken: 'enc',
      mirrorAttempts: 0,
    })
    behave = async () => {
      throw new Error('ECONNREFUSED')
    }
    await pushListMirror('owner', 'mirrored')
    const [other] = await db.select().from(templates).where(eq(templates.slug, 'other'))
    expect(other.mirrorAttempts).toBe(0)
    expect(other.mirrorError).toBeNull()
  })
})
