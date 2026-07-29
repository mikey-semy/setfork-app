import { describe, expect, it } from 'vitest'
import { voiceLine, type VoiceKind } from '@/shared/ai/voice'

// Реплики хода совета: владелец увидел, что из прогона в прогон повторяются одни и те же
// фразы. Причина была не в seed (он меняется), а в РАЗМЕРЕ наборов: при двух строках повтор
// приходит через прогон. Тест держит нижнюю границу разнообразия — иначе набор снова
// незаметно усохнет до пары строк при следующей правке.
const runs = (who: string, kind: VoiceKind, n: number) =>
  new Set(Array.from({ length: n }, (_, i) => voiceLine(who, kind, 'ru', `gen-${i}:1`, { n: '3', names: 'Книжник' })))

describe('разнообразие реплик', () => {
  it('уточняющий гейт не повторяется на десяти прогонах подряд', () => {
    expect(runs('reporter', 'clarify', 10).size).toBeGreaterThanOrEqual(4)
  })

  it('поиск прецедентов тоже', () => {
    expect(runs('seek-lists', 'seek', 10).size).toBeGreaterThanOrEqual(3)
  })

  it('одинаковый seed даёт ОДИНАКОВУЮ реплику — лента не должна дёргаться при перерисовке', () => {
    const a = voiceLine('reporter', 'clarify', 'ru', 'gen-1:1')
    const b = voiceLine('reporter', 'clarify', 'ru', 'gen-1:1')
    expect(a).toBe(b)
  })

  it('плейсхолдеры подставляются, а не уезжают в интерфейс как {n}', () => {
    const line = voiceLine('seek-lists', 'seek', 'ru', 'gen-2:1', { n: '7' })
    expect(line).not.toContain('{n}')
  })
})
