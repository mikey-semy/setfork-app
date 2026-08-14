import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЖУРНАЛ ПЕТЛИ CHANGELOG.
 *
 * Петля была единственной из одиннадцати, кто не читал свою политику и не писал журнал
 * (находка A1 линзы 06). Журнал здесь рабочее состояние: по нему предохранитель считает
 * серию ошибок, а детектор — холостой ход. Поэтому проверяем не «есть ли вызов в коде», а
 * что в журнале оказывается на каждом исходе прохода — и, главное, что РАЗНЫЕ исходы
 * различимы: недоступный GitHub не должен выглядеть как «нечего добавлять».
 */
const сеть = vi.hoisted(() => ({ ответ: null as null | { ok: boolean; status: number; json: () => Promise<unknown> } }))
vi.mock('@/shared/lib/safe-fetch', () => ({
  fetchPublicUrl: vi.fn(async () => {
    if (!сеть.ответ) throw new Error('сеть недоступна')
    return сеть.ответ
  }),
}))

const { agentActions, agentLoops, db, changelogEntries } = await import('@/shared/db')
const { refreshChangelog } = await import('@/features/changelog/service')
const { saveSettings } = await import('@/shared/settings/kv')

const журнал = async () => (await db.select().from(agentActions)).filter((a) => a.loop === 'changelog')

const ответ = (данные: unknown, status = 200) => ({ ok: status < 400, status, json: async () => данные })

beforeEach(async () => {
  // agentLoops чистим ОБЯЗАТЕЛЬНО: соседний файл контракта включает этой петле сухой
  // прогон и свою строку политики за собой не убирает, а база у интеграционных тестов
  // одна. Без этой строки все проверки ниже зелены лишь по счастливому порядку файлов —
  // стоит ему смениться, и refreshChangelog будет отвечать «сухой прогон».
  // Замечание авто-ревью на fe#800 (P2).
  await resetTables([agentActions, agentLoops, changelogEntries])
  await saveSettings({ 'changelog.enabled': 'true', 'changelog.repo': 'owner/name', 'changelog.source': 'releases' })
  сеть.ответ = null
})

describe('журнал петли changelog', () => {
  it('GitHub недоступен — виден в журнале с причиной, но цепь не рвёт', async () => {
    // Раньше сбой схлопывался в пустой список и был неотличим от пустого репозитория.
    // Различать надо, а вот статусом 'error' помечать НЕЛЬЗЯ: пять таких проходов подряд
    // сорвали бы предохранитель, который снимает только человек, и витрина погасла бы
    // навсегда из-за чужого сервера. Ровно этот инцидент описан у сборщика лент.
    // Замечания авто-ревью на fe#800.
    const res = await refreshChangelog()
    expect(res.skipped).toBe('fetch failed')
    const [запись] = await журнал()
    expect(запись.resultStatus).toBe('skipped')
    expect(запись.error).toBeTruthy()
  })

  it('GitHub ответил 404 — тоже с причиной и тоже не ошибка петли', async () => {
    // Приватный или переименованный репозиторий отдаёт анонимно именно 404.
    сеть.ответ = ответ([], 404)
    await refreshChangelog()
    const [запись] = await журнал()
    expect(запись.resultStatus).toBe('skipped')
    expect(запись.error).toContain('404')
  })

  it('репозиторий пуст — skipped БЕЗ причины: этим и отличается от сбоя', async () => {
    сеть.ответ = ответ([])
    const res = await refreshChangelog()
    expect(res.skipped).toBe('nothing pulled')
    const [запись] = await журнал()
    expect(запись.resultStatus).toBe('skipped')
    expect(запись.error).toBeFalsy()
  })

  it('пришло новое — запись ok, и холостой проход следующего раза виден отдельно', async () => {
    сеть.ответ = ответ([{ tag_name: 'v1.0', name: 'Первый релиз', published_at: '2026-08-01T00:00:00Z', html_url: 'https://e.test/1' }])
    const res = await refreshChangelog()
    expect(res.added).toBe(1)
    expect((await журнал())[0].resultStatus).toBe('ok')

    // Второй проход по тем же данным: добавлять нечего, но след остаётся — иначе петля
    // выглядела бы никогда не работавшей.
    await refreshChangelog()
    const строки = await журнал()
    expect(строки).toHaveLength(2)
    expect(строки.map((s) => s.resultStatus).sort()).toEqual(['ok', 'skipped'])
  })
})
