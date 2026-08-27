import { count } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentActions, db } from '@/shared/db'
import { hasActions, stallReport } from '@/shared/agents/stall'
import { resetTables } from '../../helpers/reset-db'

// ДЕТЕКТОР ХОЛОСТОГО ХОДА: «петля работает, деньги тратятся, а библиотека не меняется».
// Ключевое различие, которое тесты и держат: «улучшать нечего» и «оставлено человеку» — это
// НЕ прогресс, но и не поломка; прогресс — только то, после чего библиотека стала другой.
// Спутать их значит либо бить тревогу зря, либо не заметить настоящий холостой ход.

/** Опора времени — фиксированная и в прошлом: порядок не должен зависеть от часов машины. */
const BASE = Date.UTC(2026, 0, 1)

/** Номер вставки в пределах теста: он и задаёт время. */
let tick = 0

beforeAll(async () => {
  await resetTables([agentActions])
})

beforeEach(async () => {
  await db.delete(agentActions)
  tick = 0
  // Подготовка УТВЕРЖДАЕТ свой результат. Без этого оборванное соединение к базе —
  // а на общих раннерах это бывает — даёт молча непочищенную таблицу, и красным приходит
  // утверждение про бизнес-логику («ожидал 0 прогресса, получил 1») вместо правды
  // («не удалось подготовить состояние»). Отличить окружение от дефекта по такому
  // сообщению нельзя, и час уходит на гадание по load average.
  const [{ n }] = await db.select({ n: count() }).from(agentActions)
  expect(n, 'подготовка теста не удалась: таблица agent_actions не очистилась').toBe(0)
})

/**
 * ⚠️ Время задаётся ЯВНО и по счётчику, а НЕ пересчитывается из `ctid`.
 *
 * Прежний приём — `update … set occurred_at = now() + (ctid::text::point)[1] * interval
 * '1 millisecond'` — неверен по построению. `ctid` это ФИЗИЧЕСКОЕ место строки, пара
 * «страница, смещение», и вторая координата — смещение ВНУТРИ страницы. Каждый `UPDATE`
 * переписывает строку на новое место, поэтому после десятка вызовов смещения растут; а как
 * только таблица перестаёт помещаться в одну восьмикилобайтную страницу, отсчёт на новой
 * странице начинается заново — и строка, вставленная ПЕРВОЙ, получает время БОЛЬШЕ, чем
 * вставленная последней. Порядок «по вставке» ломается тем вернее, чем больше строк и чем
 * больше мёртвых версий оставили соседние тесты.
 *
 * Так падал тест «окно ограничено» (13 вставок, 13 обновлений ВСЕЙ таблицы):
 * `expected { seen: 6, progress: 1 } to match { progress: 0 }` — давний прогресс оказывался
 * среди шести свежих. Выглядело как протечка между тестами и списывалось на нагрузку.
 */
const act = async (action: string, status: 'ok' | 'skipped' | 'error' | 'dry-run' = 'ok', loop = 'gardener') => {
  tick += 1
  await db.insert(agentActions).values({ loop, action, resultStatus: status, occurredAt: new Date(BASE + tick * 1000) })
}

describe('холостой ход', () => {
  it('журнал пуст — тревоги нет (работы не было, а не «нет прогресса»)', async () => {
    expect(await stallReport('gardener')).toMatchObject({ seen: 0, progress: 0, stalled: false })
    expect(await hasActions('gardener')).toBe(false)
  })

  it('только «устоялся» и «оставлено человеку» — холостой ход', async () => {
    await act('list.stable', 'skipped')
    await act('list.hold', 'skipped')
    await act('list.stable', 'skipped')
    const r = await stallReport('gardener')
    expect(r).toMatchObject({ progress: 0, stalled: true })
    expect(r.sinceProgress).toBe(3)
  })

  it('предложенное, улучшенное, опубликованное, расхождение — прогресс', async () => {
    // Именно эти действия уход и пишет; `list.draft` — не его, а самогенерации.
    for (const a of ['list.suggest', 'list.improve', 'list.publish', 'list.fork']) await act(a)
    expect(await stallReport('gardener')).toMatchObject({ progress: 4, stalled: false, sinceProgress: 0 })
  })

  it('наблюдательная петля не холостая: её работа — само наблюдение', async () => {
    // До этой правки прогрессом считались только действия над библиотекой, поэтому
    // бухгалтер, летописец, дозор ИИ и ревизия повестки показывались холостыми ВСЕГДА —
    // на проде четыре петли из пяти живых. Находка A2 линзы 06.
    await act('money.watch', 'ok', 'finance')
    expect(await stallReport('finance')).toMatchObject({ progress: 1, stalled: false })
  })


  it('прогресс был, потом тишина — считаем, сколько действий с тех пор', async () => {
    await act('list.improve')
    await act('list.stable', 'skipped')
    await act('list.hold', 'skipped')
    expect(await stallReport('gardener')).toMatchObject({ progress: 1, stalled: false, sinceProgress: 2 })
  })

  it('сухой прогон не считается ни прогрессом, ни простоем', async () => {
    await act('list.draft', 'dry-run')
    await act('list.draft', 'dry-run')
    expect(await stallReport('gardener')).toMatchObject({ seen: 0, stalled: false })
  })

  it('неудачная попытка прогрессом не считается', async () => {
    // Действие берём ИЗ прогресса садовника: с `list.draft` (он теперь у самогенерации)
    // проверка стала бы вакуумной — отсекало бы по имени действия, и проверка статуса
    // прошла бы даже будучи удалённой. Замечание авто-ревью на fe#800 (P2).
    await act('list.suggest', 'error')
    expect(await stallReport('gardener')).toMatchObject({ progress: 0, stalled: true })
  })

  it('окно ограничено — давний прогресс не оправдывает нынешний простой', async () => {
    await act('list.improve')
    for (let i = 0; i < 12; i++) await act('list.stable', 'skipped')
    expect(await stallReport('gardener', 6)).toMatchObject({ progress: 0, stalled: true })
  })

  it('петли считаются отдельно', async () => {
    await act('list.draft', 'ok', 'selfgen')
    await act('list.stable', 'skipped', 'gardener')
    expect((await stallReport('selfgen')).stalled).toBe(false)
    expect((await stallReport('gardener')).stalled).toBe(true)
  })
})
