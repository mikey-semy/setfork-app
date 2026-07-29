import { describe, expect, it } from 'vitest'
import { CAP_WARN_SHARE, RUNWAY_WARN_DAYS, SPIKE_FACTOR, budgetAlerts, type Money } from '@/shared/agents/budget'

// Бухгалтер: правила тревог проверяем числами, а не наблюдением за счётом.
const m = (over: Partial<Money> = {}): Money => ({ spentToday: 0, avgDay: 0, dailyCap: 10, balance: 100, ...over })

describe('тревоги о деньгах', () => {
  it('спокойный день тревог не даёт', () => {
    expect(budgetAlerts(m({ spentToday: 1, avgDay: 1 }))).toEqual([])
  })

  it('подход к дневному потолку — предупреждение ДО остановки работ', () => {
    const alerts = budgetAlerts(m({ spentToday: 10 * CAP_WARN_SHARE, avgDay: 5 }))
    expect(alerts.map((a) => a.kind)).toContain('cap-near')
  })

  it('без потолка о потолке не говорим', () => {
    expect(budgetAlerts(m({ dailyCap: 0, spentToday: 999, avgDay: 999 })).map((a) => a.kind)).not.toContain('cap-near')
  })

  it('короткий остаток меряется В ДНЯХ: доллары ничего не говорят, дни говорят всё', () => {
    const alerts = budgetAlerts(m({ balance: 4, avgDay: 1, spentToday: 1 }))
    const runway = alerts.find((a) => a.kind === 'runway-short')
    expect(runway).toBeDefined()
    expect(runway!.text).toContain('дн.')
    expect(budgetAlerts(m({ balance: RUNWAY_WARN_DAYS + 1, avgDay: 1, spentToday: 1 })).map((a) => a.kind)).not.toContain('runway-short')
  })

  it('провайдер не ответил — молчим: выдуманная тревога хуже её отсутствия', () => {
    expect(budgetAlerts(m({ balance: null, avgDay: 1, spentToday: 1 })).map((a) => a.kind)).not.toContain('runway-short')
  })

  it('скачок расхода виден даже когда потолок ещё не пробит', () => {
    const alerts = budgetAlerts(m({ spentToday: 1 * SPIKE_FACTOR + 0.1, avgDay: 1, dailyCap: 100, balance: 1000 }))
    expect(alerts.map((a) => a.kind)).toEqual(['spike'])
  })

  it('первая неделя работы скачком не считается: сравнивать не с чем', () => {
    expect(budgetAlerts(m({ spentToday: 5, avgDay: 0, dailyCap: 100 })).map((a) => a.kind)).not.toContain('spike')
  })
})
