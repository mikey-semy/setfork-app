import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentActions, db } from '@/shared/db'
import { hasActions, stallReport } from '@/shared/agents/stall'

// ДЕТЕКТОР ХОЛОСТОГО ХОДА: «петля работает, деньги тратятся, а библиотека не меняется».
// Ключевое различие, которое тесты и держат: «улучшать нечего» и «оставлено человеку» — это
// НЕ прогресс, но и не поломка; прогресс — только то, после чего библиотека стала другой.
// Спутать их значит либо бить тревогу зря, либо не заметить настоящий холостой ход.

beforeAll(async () => {
  await db.execute(sql`truncate table ${agentActions}`)
})

beforeEach(async () => {
  await db.delete(agentActions)
})

const act = async (action: string, status: 'ok' | 'skipped' | 'error' | 'dry-run' = 'ok', loop = 'gardener') => {
  await db.insert(agentActions).values({ loop, action, resultStatus: status })
  // Раздвигаем во времени: порядок внутри такта иначе не определён.
  await db.execute(sql`update ${agentActions} set occurred_at = now() + (ctid::text::point)[1] * interval '1 millisecond'`)
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

  it('созданное, улучшенное, опубликованное, расхождение — прогресс', async () => {
    for (const a of ['list.draft', 'list.improve', 'list.publish', 'list.fork']) await act(a)
    expect(await stallReport('gardener')).toMatchObject({ progress: 4, stalled: false, sinceProgress: 0 })
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
    await act('list.draft', 'error')
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
