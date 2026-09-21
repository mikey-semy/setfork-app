import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ПЕРЕВОД СЛИВАЕТСЯ СО СВЕЖИМ СОСТАВОМ, А НЕ ПИШЕТ ПОВЕРХ НЕГО.
 *
 * Окно у этого маршрута самое широкое в проекте: человек жмёт «Перевести», экшен читает
 * шаги текущей версии, а потом ждёт ДВА вызова модели — десятки секунд. Раньше он писал
 * новую версию из прочитанных строк и без `expectedVersion`: всё, что соавтор успел
 * опубликовать за это время, исчезало из текущей версии, и обоим действие казалось
 * успешным.
 *
 * Отвергать здесь нельзя — за чужую правку человек заплатил бы своей минутой и
 * оплаченным вызовом модели. Поэтому решение: СЛИТЬ. Перевод ложится на свежий состав
 * по `blockId`, и только туда, где исходник блока не изменился; чего модель не видела,
 * остаётся без ключа языка (кнопка не гаснет — `hasLang` считает список переведённым
 * только целиком). Отказ остаётся ровно на случай «в свежем составе переводить нечего».
 */

const h = vi.hoisted(() => ({
  written: [] as { steps: unknown[]; meta: unknown; expectedVersion?: number }[],
  throwOnWrite: null as null | Error,
}))

vi.mock('@/shared/db', () => ({
  db: {
    query: {
      // Первый вызов — список ДО модели, второй — он же ПОСЛЕ (мог уйти вперёд).
      templates: { findFirst: vi.fn(async () => null) },
      steps: { findMany: vi.fn(async () => []) },
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ handle: 'owner' }] }) }) }),
  },
  steps: {},
  templates: {},
  users: { id: {} },
}))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: 'owner', handle: 'owner' }) }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))
vi.mock('@/shared/ai/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }))
vi.mock('@/shared/quota', () => ({ aiQuota: async () => ({ ok: true }) }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({ redirect: () => {} }))
vi.mock('@/features/library/suggestion-side-effects', () => ({ notifyWatchersNewVersion: async () => {} }))
vi.mock('@/features/library/list-store', () => ({
  listStore: {
    addVersion: vi.fn(async (_id: string, input: { steps: unknown[]; meta: unknown; expectedVersion?: number }) => {
      if (h.throwOnWrite) throw h.throwOnWrite
      h.written.push(input)
      return { version: 99 }
    }),
  },
}))
vi.mock('@/shared/ai/generate', () => ({
  generateBlockRefine: vi.fn(),
  generateChangeNote: vi.fn(),
  generateListRefine: vi.fn(),
  // Модель «переводит» приставкой EN: важно не качество, а куда ляжет результат.
  generateListTranslation: vi.fn(async (cur: { title: string; desc: string; items: { title: string }[] }) => ({
    title: `EN ${cur.title}`,
    desc: `EN ${cur.desc}`,
    items: cur.items.map((it) => ({ title: `EN ${it.title}`, desc: '', why: '', subtasks: [], refs: [] })),
  })),
  generateTextTranslation: vi.fn(async (chunks: string[]) => chunks.map((c) => `EN ${c}`)),
}))

const { ListWriteError } = await import('@/core')
const { translateList } = await import('@/features/library/actions/ai')

type Row = Record<string, unknown>
const row = (bid: string, title: string, n: number): Row => ({
  blockId: bid,
  type: 'step',
  content: null,
  title: { ru: title },
  desc: {},
  command: '',
  hasImage: false,
  imageKey: null,
  level: 'required',
  why: {},
  section: {},
  needsHuman: false,
  needsHumanAsk: {},
  danger: false,
  subtasks: [],
  refs: [],
  n,
})

/** Список в состоянии «версия N, шаги такие-то». */
const list = (version: number, rows: Row[]) => ({
  id: 't1',
  ownerId: 'owner',
  slug: 'spisok',
  title: { ru: 'Заголовок' },
  desc: { ru: 'Описание' },
  currentVersion: version,
  archivedAt: null,
  frozenAt: null,
  versions: [{ id: `v${version}`, version }],
  rows,
})

beforeEach(async () => {
  h.written = []
  h.throwOnWrite = null
  const { db } = await import('@/shared/db')
  vi.mocked(db.query.steps.findMany).mockReset()
  vi.mocked(db.query.templates.findFirst).mockReset()
})

/**
 * Поднять окружение под сценарий и позвать перевод.
 *
 * Окно моделируется порядком чтений: ПЕРВОЕ чтение списка и шагов отдаёт состояние до
 * вызова модели, ВТОРОЕ — состояние после. Именно в этот промежуток соавтор и публикует
 * свою версию.
 */
async function translate(before: ReturnType<typeof list>, after: ReturnType<typeof list> = before) {
  const { db } = await import('@/shared/db')
  let read = 0
  // `as never` — потому что drizzle возвращает свой thenable, а не голый Promise;
  // подмену это не меняет, тип согласовать иначе нечем.
  vi.mocked(db.query.templates.findFirst).mockImplementation((async () => (read++ === 0 ? before : after)) as never)
  vi.mocked(db.query.steps.findMany).mockImplementation(
    (async () => (vi.mocked(db.query.steps.findMany).mock.calls.length === 1 ? before.rows : after.rows)) as never,
  )
  return translateList('t1', 'en')
}

const stepsOf = (i = 0) => h.written[i].steps as { blockId?: string; title: Record<string, string> }[]

describe('перевод: список не двигался', () => {
  it('переводит всё и называет ядру базу', async () => {
    const before = list(5, [row('b1', 'Первый', 0), row('b2', 'Второй', 1)])
    const res = await translate(before)

    expect(res).toEqual({ ok: true })
    expect(h.written).toHaveLength(1)
    expect(stepsOf().map((s) => s.title.en)).toEqual(['EN Первый', 'EN Второй'])
    // Без базы ядру нечего сверять, и при гонке побеждает последняя запись.
    expect(h.written[0].expectedVersion).toBe(5)
  })
})

describe('перевод: соавтор опубликовал свою версию, пока работала модель', () => {
  it('НЕ теряет его блок и переводит то, что модель видела', async () => {
    const before = list(5, [row('b1', 'Первый', 0), row('b2', 'Второй', 1)])
    const after = list(6, [row('b1', 'Первый', 0), row('b2', 'Второй', 1), row('b3', 'Третий от соавтора', 2)])

    const res = await translate(before, after)

    expect(res).toEqual({ ok: true })
    // Главное: блок соавтора В ЗАПИСИ. Раньше писался состав v5, и он исчезал молча.
    expect(stepsOf().map((s) => s.blockId)).toEqual(['b1', 'b2', 'b3'])
    expect(stepsOf().map((s) => s.title.en)).toEqual(['EN Первый', 'EN Второй', undefined])
    // Непереведённый блок оставляет список «не переведённым целиком» — кнопка не гаснет.
    expect(stepsOf()[2].title.ru).toBe('Третий от соавтора')
    expect(h.written[0].expectedVersion).toBe(6)
  })

  it('переписанный блок перевода НЕ получает: он относился бы к другому тексту', async () => {
    const before = list(5, [row('b1', 'Первый', 0), row('b2', 'Второй', 1)])
    const after = list(6, [row('b1', 'Первый переписан соавтором', 0), row('b2', 'Второй', 1)])

    const res = await translate(before, after)

    expect(res).toEqual({ ok: true })
    expect(stepsOf()[0].title.ru).toBe('Первый переписан соавтором')
    expect(stepsOf()[0].title.en, 'перевод старого текста уехал бы под новый заголовок').toBeUndefined()
    expect(stepsOf()[1].title.en).toBe('EN Второй')
  })

  it('переписали всё — версии нет вовсе, и человеку сказано, что случилось', async () => {
    const before = list(5, [row('b1', 'Первый', 0)])
    const after = {
      ...list(6, [row('b9', 'Совсем другой список', 0)]),
      title: { ru: 'Другой заголовок' },
      desc: { ru: 'Другое описание' },
    }

    const res = await translate(before, after as ReturnType<typeof list>)

    // Пустая версия сдвинула бы историю, не неся ни одного перевода.
    expect(h.written).toHaveLength(0)
    expect(res).toEqual({ error: 'stale' })
  })
})

describe('перевод: отказ ядра по версии', () => {
  it('короткое окно между перечитыванием и записью — ответ, а не безымянный сбой', async () => {
    h.throwOnWrite = new ListWriteError('stale')
    const before = list(5, [row('b1', 'Первый', 0)])
    const res = await translate(before)
    expect(res).toEqual({ error: 'stale' })
  })

  it('прочие отказы записи наружу, а не под видом устаревшего списка', async () => {
    h.throwOnWrite = new ListWriteError('out-of-sync')
    const before = list(5, [row('b1', 'Первый', 0)])
    await expect(translate(before)).rejects.toThrow('out-of-sync')
  })
})
