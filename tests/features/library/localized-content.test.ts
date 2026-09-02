import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blockLabel } from '@/features/library/diff'
import { summarizeDiffForNote } from '@/features/library/change-summary'
import { carryTranslations } from '@/features/library/translation-carry'
import { toEditorItems } from '@/features/library/editor'
import { walkSrc, relSrc } from '../../helpers/walk-src'

/**
 * ⚠️ МНОГОЯЗЫЧНОЕ ПОЛЕ НЕ ПОКАЗЫВАЮТ И НЕ СРАВНИВАЮТ НАПРЯМУЮ.
 *
 * После ADR-0025 поля презентационных блоков (`content.md`, `content.caption`) стали
 * `string | LocaleText`. Там, где над ними звали `String()`, выходило `[object Object]`:
 * владелец увидел семь таких строк в списке изменений у коммита «translate → English»
 * (02.09.2026). Одно место дало семь строк — подпись блока собирают все поверхности
 * через `blockLabel`.
 *
 * Разбор вскрыл ещё два места того же корня, оба тише и хуже косметики:
 *  • редактор читал `caption` только как строку — многоязычная подпись открывалась
 *    ПУСТОЙ и затиралась при сохранении;
 *  • перенос переводов знал только `md`, поэтому подпись теряла языки при любой правке;
 *  • ключ трёхстороннего слияния давал всем текстовым блокам `text:[object object]` —
 *    сопоставились бы чужие блоки.
 */
const localized = (v: Record<string, string>) => v

describe('многоязычные поля блоков', () => {
  it('подпись блока читается, а не приводится к строке', () => {
    const label = blockLabel({
      type: 'text',
      title: '',
      content: { md: localized({ ru: 'Первая строка\nвторая' }) },
    } as never)
    expect(label).toBe('Первая строка')
    expect(label).not.toMatch(/object/i)
  })

  it('сводка изменений не содержит [object Object]', () => {
    const note = summarizeDiffForNote([
      { status: 'changed', changes: ['content'], type: 'text', title: '', content: { md: localized({ en: 'Some text' }) } },
      { status: 'added', changes: [], type: 'image', title: '', content: { caption: localized({ ru: 'Схема' }) } },
    ] as never)
    expect(note).not.toMatch(/\[object/i)
    expect(note).toMatch(/Some text/)
  })

  it('редактор открывает многоязычную подпись, а не пустоту', () => {
    const [item] = toEditorItems(
      [{ type: 'image', content: { ref: 'k', caption: localized({ ru: 'Схема сети', en: 'Network' }) } }] as never,
      'ru',
      {},
    )
    expect(item.caption, 'подпись пришла пустой — при сохранении перевод затрётся').toBe('Схема сети')
  })

  it('перенос переводов знает не только врезку, но и подпись', () => {
    const carried = carryTranslations(
      // subtasks обязателен: перенос ходит по всем переводимым полям шага.
      [{ blockId: 'b1', type: 'image', title: {}, subtasks: [], refs: [], content: { ref: 'k', caption: 'Схема сети' } }] as never,
      [
        {
          blockId: 'b1',
          type: 'image',
          title: {},
          subtasks: [],
          refs: [],
          content: { ref: 'k', caption: localized({ ru: 'Схема сети', en: 'Network' }) },
        },
      ] as never,
    )[0]
    expect(
      (carried.content as { caption: unknown }).caption,
      'подпись не изменилась, но английский потерян',
    ).toEqual({ ru: 'Схема сети', en: 'Network' })
  })

  it('правило записано: String() над content-полями запрещён', () => {
    // Узда против следующего блочного типа: он принесёт ту же беду, если правило
    // живёт только в этом тесте, а не проверяется по коду.
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../../src', import.meta.url).pathname)) {
      if (!/\.tsx?$/.test(file)) continue
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))
      // Только поля ИЗ `content`: `String(it.caption)` при разборе формы редактора
      // законен — там значение приходит строкой от клиента и его нормализуют.
      for (const m of src.matchAll(/String\(\s*(?:[\w?.]*content[\w?.]*|c)\??\.(md|caption)\b/g)) {
        offenders.push(`${relSrc(file)}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
    expect(offenders, 'многоязычное поле читают через blockText/trLoose, иначе выйдет [object Object]').toEqual([])
  })
})
