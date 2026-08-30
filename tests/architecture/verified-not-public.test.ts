import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ЗНАКА «ПРОВЕРЕН» НЕТ НИ НА ОДНОЙ ПУБЛИЧНОЙ ПОВЕРХНОСТИ.
 *
 * Решение 0006 от 07.07.2026 («видимость = верификация») говорит прямо: публичного
 * бейджа нет. Причина не косметическая — видимый публичный список и ЕСТЬ прошедший
 * проверку, а отдельный знак обещал бы вторую, которой не существует. Обещание тем
 * опаснее, что флаг стоит у сотен ЧЕРНОВИКОВ корпуса: знак на карточке означал бы
 * «кто-то это проверил» там, где никто не проверял.
 *
 * Решение приняли, а поверхности не обошли: значок жил в карточке ленты, `is:verified`
 * работал в языке поиска и стоял в подсказке синтаксиса, а MCP отдавал поле агенту —
 * то есть тот же бейдж, только машинный, по которому агент построил бы отбор.
 *
 * Флаг при этом ЗАКОННЫЙ инструмент модерации: админ его ставит и снимает, и в
 * админской таблице значок на месте. Поэтому проверяется не отсутствие слова в коде, а
 * отсутствие его на публичных поверхностях — их список здесь и есть предмет проверки.
 */
const SRC = new URL('../../src', import.meta.url).pathname

/** Публичное — всё, кроме админки, модерации и самой схемы БД. */
const INTERNAL = /\/(admin|moderation)\/|\/db\/schema\.ts$|\/gen\//

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

describe('флаг «проверен» не всплывает наружу', () => {
  it('в языке поиска нет квалификатора is:verified', () => {
    const files = walk(SRC).filter((f) => !INTERNAL.test(f))
    // Комментарии не считаются: объяснение, ПОЧЕМУ квалификатора нет, обязано остаться
    // на месте снятия — иначе следующий заведёт его заново, не зная о решении 0006.
    const offenders = files
      .filter((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .some((l) => !l.trimStart().startsWith('//') && /is:verified/.test(l)),
      )
      .map((f) => f.slice(f.indexOf('src/')))
    expect(offenders, 'публичный отбор «только проверенные» — тот же бейдж, только фильтром').toEqual([])
  })

  it('ответы MCP не несут поля verified', () => {
    const mcp = walk(join(SRC, 'features/mcp'))
    const offenders: string[] = []
    for (const f of mcp) {
      for (const [i, line] of readFileSync(f, 'utf8').split('\n').entries()) {
        if (line.trimStart().startsWith('//')) continue
        if (/\bverified:/.test(line)) offenders.push(`${f.slice(f.indexOf('src/'))}:${i + 1}`)
      }
    }
    expect(offenders, 'агент построил бы на этом поле отбор — тот же бейдж, только машинный').toEqual([])
  })

  it('карточка списка не рисует значок проверки', () => {
    const card = readFileSync(join(SRC, 'features/library/ListCardMeta.tsx'), 'utf8')
    const drawn = card.split('\n').filter((l) => !l.trimStart().startsWith('//') && /item\.verified/.test(l))
    expect(drawn, 'значок на карточке — ровно то, что запрещает решение 0006').toEqual([])
  })
})
