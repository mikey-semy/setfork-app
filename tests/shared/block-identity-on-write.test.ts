import { describe, expect, it } from 'vitest'
import { toProposed, toStepInput } from '@/shared/lib/step-input'
import { isBlockUuid } from '@/shared/lib/block-id'

/**
 * У КАЖДОГО ЗАПИСАННОГО БЛОКА ЕСТЬ ИДЕНТИЧНОСТЬ.
 *
 * На `block_id` держатся комментарии к пункту, merge по идентичности и перенос надстроек
 * при пуше: карта переноса в ядре ключуется по нему. Линза ядра 02 (20.08) измерила цену
 * пропуска настоящим пушем — шаг без идентичности теряет разом все четыре надстройки:
 * «здесь нужен человек», вопрос к человеку, «разрушительный пункт» и картинку. На проде
 * таких шагов было 610 из 5116 в 86 списках.
 *
 * Редактор выдавал id сам, пути генерации (садовник, самогенерация, гном) — нет.
 */

const item = (over: Record<string, unknown> = {}) => ({
  title: { en: 'шаг' },
  desc: {},
  command: '',
  hasImage: false,
  level: 'required' as const,
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  ...over,
})

describe('идентичность блока на записи', () => {
  it('её нет во входе — выдаётся, и это настоящий uuid', () => {
    const [step] = toStepInput([item()])
    expect(isBlockUuid(step.blockId)).toBe(true)
  })

  it('она есть — сохраняется как была', () => {
    const bid = '11111111-2222-4333-8444-555555555555'
    const [step] = toStepInput([item({ blockId: bid })])
    expect(step.blockId).toBe(bid)
  })

  it('у каждого блока своя', () => {
    const steps = toStepInput([item(), item(), item()])
    expect(new Set(steps.map((s) => s.blockId)).size).toBe(3)
  })

  it('путь генерации тоже получает идентичность', () => {
    const steps = toStepInput(toProposed([{ title: 'из модели', desc: '', command: '', section: '', level: 'required', why: '', subtasks: [], refs: [] }], 'ru'))
    expect(isBlockUuid(steps[0].blockId)).toBe(true)
  })

  /**
   * ⚠️ Отпечаток садовника обязан остаться СТАБИЛЬНЫМ. Он сравнивает
   * `JSON.stringify(toProposed(...))` как «изменилось ли», и случайный uuid внутри
   * `toProposed` сломал бы правило остановки «два прохода без изменений — хватит
   * полировать»: каждый проход выглядел бы изменением. Поэтому идентичность выдаётся
   * в `toStepInput` (запись), а не в `toProposed` (сравнение).
   */
  it('отпечаток для сравнения не меняется от вызова к вызову', () => {
    const gen = [{ title: 'а', desc: '', command: '', section: '', level: 'required' as const, why: '', subtasks: [], refs: [] }]
    expect(JSON.stringify(toProposed(gen, 'ru'))).toBe(JSON.stringify(toProposed(gen, 'ru')))
  })
})
