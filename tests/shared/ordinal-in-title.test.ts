import { describe, expect, it } from 'vitest'
import { JSON_SHAPE } from '@/shared/ai/generate'
import { itemShape } from '@/features/mcp/registry/block-schema'
import { splitOrdinal, stripOrdinal } from '@/shared/lib/ordinal'
import { toProposed, toStepInput } from '@/shared/lib/step-input'

/**
 * НОМЕР РИСУЕТ ИНТЕРФЕЙС, А НЕ ТЕКСТ.
 *
 * Модель об этом не знала и писала номер ещё и в заголовок: секция «1. Подтверждение
 * оповещения», под которой оглавление ставит свою единицу. Владелец увидел двойную
 * нумерацию на живом списке, созданном через MCP.
 *
 * Дефект двусоставный, и половины лечатся по-разному: модели надо СКАЗАТЬ (подсказка
 * генерации и схема MCP — единственное, что она про поля знает), а на записи —
 * ПРОВЕРИТЬ, потому что сказанному модель следует не всегда.
 */

describe('что знает модель', () => {
  it('подсказка генерации запрещает нумеровать заголовки', () => {
    expect(JSON_SHAPE).toMatch(/NEVER number them/)
  })

  it('схема MCP говорит то же самое у title и section', () => {
    const shape = itemShape.shape
    expect(shape.title.description).toMatch(/Do NOT number it/)
    expect(shape.section.description).toMatch(/Do NOT number it/)
  })
})

describe('узда на записи', () => {
  const cases: [string, string][] = [
    ['1. Подтверждение оповещения', 'Подтверждение оповещения'],
    ['2) Оценка масштаба', 'Оценка масштаба'],
    ['12. Восстановление', 'Восстановление'],
    ['Шаг 3: Подключение к серверу', 'Подключение к серверу'],
    ['Step 4. Check the logs', 'Check the logs'],
  ]
  it.each(cases)('«%s» → «%s»', (given, want) => {
    expect(stripOrdinal(given)).toBe(want)
  })

  // Граница узкая намеренно: срезать лишнее хуже, чем не срезать — заголовок теряет смысл.
  const kept = ['1.5 л воды', '7 способов заварить чай', '2026 год: итоги', 'v1. беглый черновик', '3', '10.5% раствор']
  it.each(kept)('«%s» остаётся как есть', (given) => {
    expect(stripOrdinal(given)).toBe(given)
  })

  it('снимается у заголовка И у секции, на всех языках сразу', () => {
    const steps = toStepInput([
      {
        title: { ru: '1. Проверить связь', en: '1. Check the link' },
        section: { ru: '2. Восстановление', en: '2. Recovery' },
        desc: {},
        why: {},
        command: '',
        hasImage: false,
        level: 'required',
        subtasks: [],
        refs: [],
      },
    ])
    expect(steps[0].title).toEqual({ ru: 'Проверить связь', en: 'Check the link' })
    expect(steps[0].section).toEqual({ ru: 'Восстановление', en: 'Recovery' })
  })

  it('доезжает от ответа модели до шагов на запись', () => {
    const steps = toStepInput(
      toProposed(
        [{ title: '1. Подтверждение оповещения', desc: '', command: '', section: '1. Обнаружение', level: 'required', why: '', subtasks: [], refs: [] }],
        'ru',
      ),
    )
    expect(steps[0].title).toEqual({ ru: 'Подтверждение оповещения' })
    expect(steps[0].section).toEqual({ ru: 'Обнаружение' })
  })
})

/**
 * ПОКАЗ УЖЕ ЗАПИСАННОГО. Узда на записи новые списки лечит, а созданные раньше — нет:
 * номер лежит в тексте, и убрать его можно только правкой с публикацией. Владелец на это
 * и указал — «неубираемая информация». Поэтому при показе номер автора уходит в колонку
 * номера вместо нашего: дубля нет, и авторская многоуровневая нумерация видна.
 */
describe('номер при показе', () => {
  it.each([
    ['1. Подтверждение оповещения', '1', 'Подтверждение оповещения'],
    ['1.1. Введение', '1.1', 'Введение'],
    ['2.3.4) Проверка', '2.3.4', 'Проверка'],
  ])('«%s» → номер «%s», текст «%s»', (given, num, text) => {
    expect(splitOrdinal(given)).toEqual({ num, text })
  })

  // Без разделителя «1.5 л воды» неотличимо от «1.1 Введение» — и заголовок рецепта
  // развалился бы на номер и «л воды». Не распознали — показываем как есть.
  it.each(['1.5 л воды', '7 способов заварить чай', '2026 год: итоги', 'Проверить связь'])(
    '«%s» остаётся заголовком целиком',
    (given) => {
      expect(splitOrdinal(given)).toEqual({ num: null, text: given })
    },
  )
})
