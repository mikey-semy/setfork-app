import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАПИСЬ В РАБОЧУЮ КОПИЮ НЕ ТЕРЯЕТ ЧУЖОЙ ТРУД МОЛЧА.
 *
 * Черновик у автора ОДИН на список, а входов в него два: редактор и агент по MCP,
 * который действует ОТ ИМЕНИ ТОГО ЖЕ ЧЕЛОВЕКА (`patch_list` с publish:false пишет в эту
 * же строку). Человек правит формулировки, агент в это время патчит блоки; человек
 * жмёт «Сохранить» — его состав ложится поверх, агент получает «успех» и подсказку
 * «публикуй версию N+1». Ни один из двоих не узнавал ничего.
 *
 * ⚠️ Лечение выбрано НЕ отказом. Форма редактора серверная: отказ уходит редиректом,
 * страница перечитывает черновик из базы, и набранное пропадает. Отказ, после которого
 * работа потеряна, хуже гонки, от которой он защищает. Поэтому запись идёт всегда, но
 * возвращает признак `overwrote`, и редактор говорит человеку, что случилось.
 *
 * Тест на КЛАСС: кто с чем пришёл — и что запись обязана про это сказать.
 */

const { db, users, templates, listDrafts } = await import('@/shared/db')
type ProposedItem = import('@/shared/db').ProposedItem
const { upsertDraft } = await import('@/features/library/draft')

let ownerId = ''
let tpl = { id: '', currentVersion: 1, tags: [] as string[], ordered: true, gated: false }

// Минимальный элемент нужной формы: тесту важен факт записи, а не состав блока.
const items = (title: string) => [{ title: { ru: title, en: title } } as unknown as ProposedItem]

beforeEach(async () => {
  await resetTables([listDrafts, templates, users])
  const [u] = await db.insert(users).values({ handle: 'draft-owner' }).returning({ id: users.id })
  ownerId = u.id
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: 'l1', title: { ru: 'Список', en: 'List' }, status: 'draft' })
    .returning({ id: templates.id, currentVersion: templates.currentVersion })
  tpl = { id: t.id, currentVersion: t.currentVersion, tags: [], ordered: true, gated: false }
})

const save = (author: string, title: string, expectedRev?: number) =>
  upsertDraft(tpl, author, { items: items(title), meta: {}, note: '' }, { expectedRev })

const storedTitle = async (author: string) => {
  const [row] = await db
    .select({ items: listDrafts.items })
    .from(listDrafts)
    .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, author)))
  return (row?.items as unknown as Array<{ title: { ru: string } }>)[0]?.title.ru
}

describe('рабочая копия сообщает о затирании', () => {
  it('черновик ушёл вперёд — запись проходит и ГОВОРИТ об этом', async () => {
    const first = await save(ownerId, 'из редактора')
    // Агент патчит тот же черновик от имени того же человека: rev растёт.
    await save(ownerId, 'от агента')

    // Человек жмёт «Сохранить» с редакцией, которую ему показали при открытии.
    const res = await save(ownerId, 'из редактора, позже', first.rev)

    expect(res.overwrote, 'затирание чужих правок осталось незамеченным').toBe(true)
    expect(await storedTitle(ownerId), 'набранное человеком обязано сохраниться: отказ терял бы его').toBe(
      'из редактора, позже',
    )
  })

  // ⚠️ Обратная сторона: предупреждать без повода — значит научить его не читать.
  it('ничего не менялось — предупреждения нет', async () => {
    const first = await save(ownerId, 'первый')

    const res = await save(ownerId, 'второй', first.rev)

    expect(res.overwrote, 'предупреждение показано на ровном месте').toBe(false)
    expect(await storedTitle(ownerId)).toBe('второй')
  })

  it('первое сохранение (черновика ещё нет) — не затирание', async () => {
    const res = await save(ownerId, 'первый', 0)
    expect(res.overwrote).toBe(false)
  })

  // ⚠️ P1 авто-ревью по #945. Страницу открыли, когда черновика НЕ БЫЛО; агент создал
  // его, пока человек правил. Форма обязана прислать 0 — «черновика не было», — и это
  // должно отличаться от «поля не прислали»: пустая строка превращалась в `undefined`,
  // а он отключал сверку целиком, и первое же «Сохранить» стирало правки агента молча.
  it('черновик ПОЯВИЛСЯ, пока страница была открыта — затирание замечено', async () => {
    // Человек открыл страницу: черновика нет, форма несёт rev = 0.
    // Агент создаёт черновик — это первая запись, rev станет 1.
    await save(ownerId, 'от агента')

    const res = await save(ownerId, 'из редактора', 0)

    expect(res.overwrote, 'черновик, созданный агентом, стёрт молча').toBe(true)
  })

  it('запись без ожидаемой редакции (путь MCP) ведёт себя как прежде', async () => {
    await save(ownerId, 'из редактора')
    // Агент правит от свежего чтения под тем же замком — сверять ему не с чем.
    const res = await save(ownerId, 'от агента')
    expect(res.overwrote, 'агент получил предупреждение, которого не заслужил').toBe(false)
    expect(await storedTitle(ownerId)).toBe('от агента')
  })

  it('редакция растёт на каждой записи — иначе сравнивать нечего', async () => {
    const a = await save(ownerId, 'раз')
    const b = await save(ownerId, 'два')
    expect(b.rev, 'rev не инкрементируется: признак затирания станет бессмысленным').toBeGreaterThan(a.rev)
  })
})
