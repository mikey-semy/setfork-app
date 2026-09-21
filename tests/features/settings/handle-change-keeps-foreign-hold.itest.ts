import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПЕРЕИМЕНОВАНИЕ УБИРАЕТ СВОИ ЗАПИСИ УДЕРЖАНИЯ, А НЕ ВСЕ НА ЭТО ИМЯ.
 *
 * Смена ника снимает записи на два имени — на старое (человек может к нему вернуться)
 * и на новое (иначе осталась бы запись-сирота, уводящая с уже занятого имени). Удаление
 * шло по одному только `handle`, без владельца и без срока: под него попадала и ЖИВАЯ
 * запись другого человека.
 *
 * ⚠️ Почему это чинится, хотя «сейчас недостижимо». Занять чужой живой удерживаемый ник
 * не даёт канон (`handleBlock`), — то есть безопасность запроса держалась не на нём
 * самом, а на том, что рядом никто не ошибётся. Ровно так это и сломалось в H1-001:
 * регистрация ходила мимо канона, посторонний занимал чужой удерживаемый ник, а затем
 * его собственное переименование стирало чужую запись молча. Дыру закрыли, запрос
 * остался прежним — и следующая ошибка рядом снова сделала бы его достижимым.
 *
 * Класс, который стережёт тест: «удаляем только то, что НАШЕ или уже НЕ ДЕЙСТВУЕТ».
 */

const session = vi.hoisted(() => ({ userId: '', handle: '', sid: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle, sid: session.sid }),
  refreshSessionCookie: vi.fn(async () => {}),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
// Успешная смена ника уводит на настройки: без подмены Next бросает NEXT_REDIRECT,
// и падение выглядит как отказ действия, хотя оно как раз удалось.
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
vi.mock('@/shared/auth/app-origin', () => ({ clientIpFromHeaders: async () => '127.0.0.1' }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))

const { db, users, userRedirects } = await import('@/shared/db')
const { changeHandle } = await import('@/features/settings/actions')

const form = (handle: string): FormData => {
  const fd = new FormData()
  fd.append('handle', handle)
  return fd
}

/** Смена ника: `{error}` при отказе, `null` при успехе (успех уводит редиректом). */
async function rename(handle: string): Promise<{ error?: string } | null> {
  try {
    return (await changeHandle(null, form(handle))) ?? null
  } catch (e) {
    if (e instanceof Error && e.message === 'REDIRECT') return null
    throw e
  }
}

/** Сутки в миллисекундах — возраст записи задаём явно, чтобы не ждать 180 дней. */
const DAY = 24 * 60 * 60 * 1000

async function addUser(handle: string, email: string) {
  const [u] = await db.insert(users).values({ handle, email, name: handle }).returning()
  return u
}

/** Запись удержания заданного возраста: свежая — живая, старая — истёкшая. */
async function addHold(handle: string, userId: string, ageDays: number) {
  await db
    .insert(userRedirects)
    .values({ handle, userId, createdAt: new Date(Date.now() - ageDays * DAY) })
}

const holdsOf = (handle: string) =>
  db.select({ userId: userRedirects.userId }).from(userRedirects).where(eq(userRedirects.handle, handle))

beforeEach(async () => {
  await resetTables([userRedirects, users])
})

describe('смена ника не трогает чужое живое удержание', () => {
  it('ЖИВАЯ чужая запись на прежнем нике переживает переименование', async () => {
    const bob = await addUser('bob-new', 'bob@example.test')
    // Боб когда-то звался `shared`; удержание свежее и действует.
    await addHold('shared', bob.id, 1)
    // Алиса сидит на `shared` (так вышло — это и есть след H1-001) и переименовывается.
    const alice = await addUser('shared', 'alice@example.test')
    Object.assign(session, { userId: alice.id, handle: 'shared', sid: '' })

    const res = await rename('alice-new')
    expect(res?.error, 'переименование должно пройти').toBeFalsy()

    const rows = await holdsOf('shared')
    expect(
      rows.map((r) => r.userId),
      'живая запись Боба стёрта чужим переименованием — его старые ссылки осиротели',
    ).toContain(bob.id)
    // И своего удержания на чужое имя не появляется: оно не её, уходя — уходит.
    expect(
      rows.map((r) => r.userId),
      'уходящая забрала себе чужое удерживаемое имя',
    ).not.toContain(alice.id)
  })

  it('ИСТЁКШУЮ чужую запись переименование убирает — иначе имя не освободить', async () => {
    const bob = await addUser('bob-new', 'bob@example.test')
    await addHold('stale', bob.id, 400) // срок давно вышел
    const alice = await addUser('stale', 'alice@example.test')
    Object.assign(session, { userId: alice.id, handle: 'stale', sid: '' })

    const res = await rename('alice-new')
    expect(res?.error).toBeFalsy()

    const rows = await holdsOf('stale')
    expect(
      rows.map((r) => r.userId),
      'истёкшая запись осталась и заблокировала бы вставку нового удержания на это имя',
    ).not.toContain(bob.id)
  })

  it('СВОЯ запись снимается: к прежнему нику можно вернуться', async () => {
    const alice = await addUser('alice-now', 'alice@example.test')
    await addHold('alice-was', alice.id, 1) // свежая, но своя
    Object.assign(session, { userId: alice.id, handle: 'alice-now', sid: '' })

    const res = await rename('alice-was')
    expect(res?.error, 'к своему прежнему нику вернуться можно').toBeFalsy()

    const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, alice.id))
    expect(row.handle).toBe('alice-was')
    // На прежнем имени теперь запись о возврате, и она тоже её.
    const back = await db
      .select({ userId: userRedirects.userId })
      .from(userRedirects)
      .where(and(eq(userRedirects.handle, 'alice-now'), eq(userRedirects.userId, alice.id)))
    expect(back.length, 'прежний ник обязан продолжать вести на этого же человека').toBe(1)
  })
})
