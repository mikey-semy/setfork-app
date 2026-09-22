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
const { deleteDraft, upsertDraft } = await import('@/features/library/draft')

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

type DraftRef = { id: string; rev: number } | 'none'
const save = (author: string, title: string, expected?: DraftRef, listVersion?: number) =>
  upsertDraft(
    tpl,
    author,
    { items: items(title), meta: {}, note: '' },
    { expected: expected === undefined ? undefined : { listVersion: listVersion ?? tpl.currentVersion, draft: expected } },
  )

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
    const res = await save(ownerId, 'из редактора, позже', { id: first.id, rev: first.rev })

    expect(res.overwrote, 'затирание чужих правок осталось незамеченным').toBe(true)
    expect(await storedTitle(ownerId), 'набранное человеком обязано сохраниться: отказ терял бы его').toBe(
      'из редактора, позже',
    )
  })

  // ⚠️ Обратная сторона: предупреждать без повода — значит научить его не читать.
  it('ничего не менялось — предупреждения нет', async () => {
    const first = await save(ownerId, 'первый')

    const res = await save(ownerId, 'второй', { id: first.id, rev: first.rev })

    expect(res.overwrote, 'предупреждение показано на ровном месте').toBe(false)
    expect(await storedTitle(ownerId)).toBe('второй')
  })

  it('первое сохранение (черновика ещё нет) — не затирание', async () => {
    const res = await save(ownerId, 'первый', 'none')
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

    const res = await save(ownerId, 'из редактора', 'none')

    expect(res.overwrote, 'черновик, созданный агентом, стёрт молча').toBe(true)
  })

  // ⚠️ ABA. Второй P1 авто-ревью: номер каждого нового черновика начинается с 1, поэтому
  // голый счётчик опознаёт не объект, а его возраст. Черновик, который видел автор,
  // опубликовали или отбросили; агент завёл НОВЫЙ — у обоих rev = 1, и сравнение по
  // числу сказало бы «ничего не менялось».
  it('черновик ЗАМЕНИЛИ на другой с тем же номером — затирание замечено', async () => {
    const seen = await save(ownerId, 'что видел автор')
    expect(seen.rev, 'предпосылка: первый черновик имеет rev = 1').toBe(1)

    // Его опубликовали или отбросили, а агент завёл свой — новая строка, снова rev = 1.
    await deleteDraft(tpl.id, ownerId)
    const agent = await save(ownerId, 'черновик агента')
    expect(agent.rev, 'предпосылка: у новой строки тот же номер').toBe(1)
    expect(agent.id, 'предпосылка: строка ДРУГАЯ').not.toBe(seen.id)

    const res = await save(ownerId, 'из старого редактора', { id: seen.id, rev: seen.rev })

    expect(res.overwrote, 'ABA: номер совпал, объект другой — правки агента заменены молча').toBe(true)
  })

  // ⚠️ ПОЛНЫЙ ЦИКЛ none → черновик → опубликован → none. Третий P1 авто-ревью: признак
  // «строка + номер» опознаёт СТРОКУ ЧЕРНОВИКА, а событие произошло со СПИСКОМ. Автор
  // открыл редактор на версии N без черновика; агент завёл черновик и опубликовал его
  // как N+1, строка исчезла — и автор снова видит «черновика нет», своё исходное
  // состояние. Признак совпадает, удержания нет, а правка агента уже в версии.
  it('черновик появился и БЫЛ ОПУБЛИКОВАН — затирание замечено', async () => {
    // Автор открыл страницу: версия 1, черновика нет.
    const seenAt = { ...tpl }

    // Агент поработал и опубликовал: список ушёл на версию 2, черновика снова нет.
    tpl = { ...tpl, currentVersion: seenAt.currentVersion + 1 }

    const res = await save(ownerId, 'из редактора', 'none', seenAt.currentVersion)

    expect(res.overwrote, 'опубликованная правка агента затирается молча').toBe(true)
  })

  // ⚠️ Обратная сторона: версия не менялась и черновика нет — удерживать нечего,
  // иначе первое же сохранение на чистом списке пугает человека без повода.
  it('черновика нет и версия та же — предупреждения нет', async () => {
    const res = await save(ownerId, 'первый', 'none', tpl.currentVersion)
    expect(res.overwrote, 'предупреждение на ровном месте').toBe(false)
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
    expect(b.id, 'строка та же — правки копятся, а не пересоздаются').toBe(a.id)
  })
})
