import { describe, expect, it } from 'vitest'
import { buildCouncilPool } from '@/shared/ai/council'
import { modelAllowed, parseModelAllowlist } from '@/shared/settings/ai'

/**
 * БЕЛЫЙ СПИСОК МОДЕЛЕЙ — ограничение владельца: «в проде разрешено только это».
 *
 * Его заводят, чтобы дорогая или неподходящая модель не ушла в работу. Проверка
 * `usable` применяет его к моделям личных специалистов, а пул совета собирался
 * фильтром одного лишь провайдера — то есть ограничение обходилось самым дорогим
 * путём: быстрой моделью, ротацией экспертов, критиком и старейшиной.
 *
 * Здесь проверяется само правило, на которое опирается пул после правки.
 */
describe('правило белого списка', () => {
  it('пустой список ничего не ограничивает', () => {
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: '' })
    expect(modelAllowed('openai/gpt-4o', list)).toBe(true)
    expect(modelAllowed('дорогая/модель', list)).toBe(true)
  })

  it('заданный список пропускает только своих', () => {
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: 'openai/gpt-4o, anthropic/claude' })
    expect(modelAllowed('openai/gpt-4o', list)).toBe(true)
    expect(modelAllowed('anthropic/claude', list)).toBe(true)
    expect(modelAllowed('openai/o1-pro', list)).toBe(false)
  })

  it('суффиксы вроде :online не выводят модель из-под списка', () => {
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: 'openai/gpt-4o' })
    expect(modelAllowed('openai/gpt-4o:online', list)).toBe(true)
  })
})

/**
 * СБОРКА ПУЛА — три правила, которые легко нарушить поодиночке.
 *
 * Пул отдаёт модели быстрым шагам, ротации экспертов и новатору (`pool[0]`). Стоило
 * применить к нему жёсткий фильтр — и появился случай, когда после фильтрации не
 * остаётся ничего: белый список стенда разрешает только настроенную модель, а
 * councilModels пуст, то есть в сыром пуле лежат встроенные умолчания. Новатор при
 * этом вызывался с `undefined` вместо модели (P1 из авто-ревью Codex на #577).
 */
describe('сборка пула совета', () => {
  const NONE: ReadonlySet<string> = new Set()
  const only = (...ids: string[]) => (m: string) => ids.includes(m)

  it('жёсткие фильтры вымели всё → пул не пустой, в нём базовая модель', () => {
    // Белый список разрешает лишь base, а пул — встроенные умолчания.
    const pool = buildCouncilPool(['a/deflt-1', 'a/deflt-2'], only('base/model'), NONE, 'base/model')
    expect(pool).toEqual(['base/model'])
    expect(pool[0], 'новатор получил бы undefined').toBeDefined()
  })

  it('запрещённая модель в пул не попадает', () => {
    const pool = buildCouncilPool(['a/ok', 'дорогая/модель'], only('a/ok'), NONE, 'base/model')
    expect(pool).toEqual(['a/ok'])
  })

  it('карантин мягкий: просели ВСЕ разрешённые → работаем на просевших, а не на base', () => {
    const pool = buildCouncilPool(['a/ok', 'b/ok'], only('a/ok', 'b/ok'), new Set(['a/ok', 'b/ok']), 'base/model')
    expect(pool).toEqual(['a/ok', 'b/ok'])
  })

  it('карантин убирает просевшую, пока есть здоровые', () => {
    const pool = buildCouncilPool(['a/ok', 'b/ok'], only('a/ok', 'b/ok'), new Set(['a/ok']), 'base/model')
    expect(pool).toEqual(['b/ok'])
  })
})
