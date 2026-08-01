import { describe, expect, it, vi } from 'vitest'

// Модуль подметальщика тянет пул и очередь только ради самого прохода; решение
// «кого пора трогать» от базы не зависит — его и проверяем.
vi.mock('@/shared/db', () => ({
  db: {},
  jobs: {},
  templates: {},
  users: {},
}))

const { dueMirrors } = await import('@/features/library/mirror-jobs')
const { MIRROR_HELP_AFTER_ATTEMPTS, mirrorRetryDelayMs, mirrorRetryDueAt } = await import(
  '@/features/library/mirror-policy'
)

const MIN = 60_000
const at = (msAgo: number) => new Date(Date.now() - msAgo)

/**
 * Зеркало — витрина и резервная копия, и временный сбой сети не имеет права
 * оставить его отставшим навсегда. Но и повторять вечно нельзя: отозванный токен
 * повторами не лечится, а бесконечные попытки шумят в чужой фордже и прячут от
 * владельца, что нужны его руки. Обе границы держит эта пара функций.
 */
describe('повторы зеркала — пауза растёт, попытки кончаются', () => {
  it('первую попытку не откладываем: пуша не было ни разу', () => {
    expect(mirrorRetryDueAt(0, null).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('пауза растёт с каждой неудачей', () => {
    const d1 = mirrorRetryDelayMs(1)
    expect(mirrorRetryDelayMs(2)).toBeGreaterThan(d1)
    expect(mirrorRetryDelayMs(4)).toBeGreaterThan(mirrorRetryDelayMs(3))
  })

  it('пауза упирается в сутки, а не растёт до бесконечности', () => {
    // Иначе после серии неудач следующая попытка назначалась бы через годы —
    // формально «повторим автоматически», практически никогда.
    expect(mirrorRetryDelayMs(50)).toBe(24 * 3600_000)
  })

  it('свежую неудачу не трогаем, вылежавшуюся — берём', () => {
    const fresh = { attempts: 1, syncedAt: at(1 * MIN) }
    const stale = { attempts: 1, syncedAt: at(24 * 60 * MIN) }
    const due = dueMirrors([fresh, stale], Date.now())
    expect(due).toEqual([stale])
  })

  it('чем больше неудач, тем дольше ждём — та же отметка времени решается по-разному', () => {
    const ago = at(30 * MIN)
    const due = dueMirrors([{ attempts: 1, syncedAt: ago }, { attempts: 5, syncedAt: ago }], Date.now())
    expect(due).toHaveLength(1)
    expect(due[0]?.attempts).toBe(1)
  })

  it('давняя серия неудач НЕ выбывает из повторов — только разрежается до суток', () => {
    // Это главное отличие от первой версии, где после N попыток зеркало
    // переставало пробовать. Половина причин чинится на стороне форджи без нас
    // (перевыпустили токен, вернули репозиторий, кончилась авария) — остановка
    // превращала бы самолечащийся сбой в требующий ручного действия.
    const hopeless = { attempts: MIRROR_HELP_AFTER_ATTEMPTS + 20, syncedAt: at(25 * 60 * MIN) }
    expect(dueMirrors([hopeless], Date.now())).toEqual([hopeless])
  })

  it('но раньше суток такое зеркало не трогаем', () => {
    const hopeless = { attempts: MIRROR_HELP_AFTER_ATTEMPTS + 20, syncedAt: at(23 * 60 * MIN) }
    expect(dueMirrors([hopeless], Date.now())).toEqual([])
  })
})
