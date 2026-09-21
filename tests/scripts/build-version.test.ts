import { describe, expect, it } from 'vitest'
import { commitTypes, versionOf } from '../../scripts/build-version.mjs'

/**
 * НОМЕР ВЕРСИИ ВЫВОДИТСЯ ИЗ ИСТОРИИ, а не хранится руками.
 *
 * В package.json стоял `0.1.0` с первого коммита проекта, и футер всё это время
 * показывал одно и то же число: по такому номеру нельзя сказать, какая сборка перед
 * тобой. Здесь проверяется сама арифметика — то, что переживёт смену способа
 * доставки номера в образ.
 */
describe('номер версии из истории', () => {
  it('считает feat и правки после последнего из них', () => {
    expect(versionOf(['feat', 'fix', 'feat', 'fix', 'docs'])).toBe('0.2.2')
  })

  it('без единого feat весь счёт уходит в последнее число', () => {
    expect(versionOf(['fix', 'docs', 'chore'])).toBe('0.0.3')
  })

  it('⚠️ feat последним даёт нулевой хвост, а не единицу', () => {
    // Иначе «только что выпущенный feat» и «feat плюс одна правка» неразличимы.
    expect(versionOf(['fix', 'feat'])).toBe('0.1.0')
  })

  it('пустая история даёт нули, а не падение', () => {
    expect(versionOf([])).toBe('0.0.0')
  })

  it('разбирает вид изменения из заголовка, включая область и восклицательный знак', () => {
    expect(commitTypes('feat(mcp): что-то\nfix!: иначе\nПросто строка')).toEqual(['feat', 'fix', 'other'])
  })

  it('⚠️ отказ git называет причину в stderr, а не молчит', async () => {
    // Выкатка 21.09.2026 прошла с прежним номером, и в журнале было только
    // «посчитать не удалось». Причина осталась неизвестной, потому что её никто
    // не напечатал: пустая строка возвращалась одинаково и когда истории нет, и
    // когда git отказал. Здесь проверяется ИМЕННО это — что причина видна.
    const { buildVersion } = await import('../../scripts/build-version.mjs')
    const said: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- подменяем только сток вывода
    ;(process.stderr as any).write = (chunk: string) => (said.push(String(chunk)), true)
    try {
      expect(buildVersion('/nonexistent-for-this-test')).toBe('')
    } finally {
      ;(process.stderr as any).write = orig
    }
    expect(said.join('')).toContain('build-version: git')
  })
})
