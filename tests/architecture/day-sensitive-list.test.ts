import { describe, expect, it } from 'vitest'
import { daySensitiveTests } from '../../scripts/day-sensitive-tests.mjs'

/**
 * Список день-зависимых тестов ВЫВОДИТСЯ, а не перечисляется.
 *
 * ⚠️ Ровно та ошибка, на которой обожглась узда склонений: проверка, перебирающая
 * ИЗВЕСТНОЕ, видит только заведённое и молчит про новое. Здесь список считается по
 * признаку — суточное окно рядом с относительным временем, — поэтому новый тест такой же
 * формы попадёт под недельный прогон сам, без правки воркфлоу.
 */
describe('кого гонять у границы суток', () => {
  it('находит тот файл, на котором класс и обнаружился', () => {
    // ai-watch считает вызовы за календарный день — он и падал в 00:27 UTC.
    expect(daySensitiveTests()).toContain('tests/features/backoffice/ai-watch.itest.ts')
  })

  it('не тащит в список всё подряд: без суточного окна файл не нужен', () => {
    const list = daySensitiveTests()
    expect(list.length, 'если список разросся до десятков — признак стал бесполезен').toBeLessThan(15)
    expect(list.every((p: string) => p.endsWith('.itest.ts'))).toBe(true)
  })
})
