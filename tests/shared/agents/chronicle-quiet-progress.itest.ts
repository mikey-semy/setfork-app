import { describe, expect, it, beforeEach } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ТИХИЙ ДЕНЬ ЛЕТОПИСЦА — СДЕЛАННАЯ РАБОТА, А НЕ ПРОПУСК.
 *
 * Летописец наблюдательный: посмотреть и убедиться, что писать не о чем, — и есть его дело.
 * Раньше такой проход писался со статусом `skipped`, а детектор холостого хода считает
 * прогрессом только `ok` — и свежая установка, где событий ещё не было, объявлялась
 * застрявшей с первого же НОРМАЛЬНОГО прохода (авто-ревью на #800). Индикатор, который
 * всегда красный, не индикатор: настоящий холостой ход в нём утонет.
 */
const { db, agentActions, users } = await import('@/shared/db')
const { runChronicleSweep } = await import('@/features/backoffice/service')
const { stallReport } = await import('@/shared/agents/stall')

beforeEach(async () => {
  await resetTables([agentActions, users])
})

describe('день без событий', () => {
  it('засчитывается детектору как работа', async () => {
    // Ничего не происходило: свежая установка, событий компании нет.
    const res = await runChronicleSweep()
    expect(res.skipped).toBeTruthy()

    const rows = await db.select({ action: agentActions.action, status: agentActions.resultStatus }).from(agentActions)
    expect(rows).toContainEqual({ action: 'day.quiet', status: 'ok' })

    const report = await stallReport('chronicle')
    expect(report.stalled).toBe(false)
  })
})
