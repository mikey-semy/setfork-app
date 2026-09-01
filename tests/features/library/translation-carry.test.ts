import { describe, expect, it } from 'vitest'
import { carryField, carryTranslations, type NextStep, type PrevStep } from '@/features/library/translation-carry'

/**
 * Редактор одноязычный: он кладёт поле как `{ [lang]: value }`. Без переноса
 * любая правка опечатки стирала перевод всего списка.
 */

const next = (over: Partial<NextStep> = {}): NextStep => ({
  blockId: 'b1',
  type: 'step',
  title: { ru: 'Установить' },
  desc: {},
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  ...over,
})

const prev = (over: Partial<PrevStep> = {}): PrevStep => ({
  blockId: 'b1',
  type: 'step',
  title: { ru: 'Установить', en: 'Install' },
  desc: {},
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  content: {},
  ...over,
})

describe('carryField', () => {
  it('не тронули поле — прежнее значение целиком', () => {
    expect(carryField({ ru: 'Текст' }, { ru: 'Текст', en: 'Text' })).toEqual({ ru: 'Текст', en: 'Text' })
  })

  it('изменили — прежние переводы отбрасываются как устаревшие', () => {
    expect(carryField({ ru: 'Другой' }, { ru: 'Текст', en: 'Text' })).toEqual({ ru: 'Другой' })
  })

  /** Иначе очистить поле стало бы невозможно: оно возвращалось бы из прошлого. */
  it('очистка поля проходит', () => {
    expect(carryField({}, { ru: 'Текст', en: 'Text' })).toEqual({})
  })

  it('у нового поля переносить нечего', () => {
    expect(carryField({ ru: 'Новое' }, {})).toEqual({ ru: 'Новое' })
  })

  /**
   * Поле показано ОТКАТОМ (перевода на язык интерфейса нет) и не тронуто — ключ
   * этого языка добавлять нельзя: иначе английский текст запишется как русский
   * перевод, и кнопка «Перевести» решит, что переводить уже нечего.
   */
  it('не выдаёт фолбэк за перевод', () => {
    expect(carryField({ ru: 'Install' }, { en: 'Install' })).toEqual({ en: 'Install' })
  })
})

describe('carryTranslations', () => {
  it('возвращает переводы шага при ручном сохранении', () => {
    const [out] = carryTranslations([next()], [prev()])
    expect(out.title).toEqual({ ru: 'Установить', en: 'Install' })
  })

  it('правка текста уносит только перевод этого поля', () => {
    const [out] = carryTranslations(
      [next({ title: { ru: 'Поставить' }, why: { ru: 'Затем' } })],
      [prev({ why: { ru: 'Затем', en: 'Because' } })],
    )
    expect(out.title).toEqual({ ru: 'Поставить' })
    expect(out.why).toEqual({ ru: 'Затем', en: 'Because' })
  })

  /** Идентичность блока — единственное, по чему шаги сопоставляются: по позиции
   *  вставка блока в середину прилепила бы перевод к чужому пункту. */
  it('новый блок ничего не наследует', () => {
    const [out] = carryTranslations([next({ blockId: 'b2' })], [prev()])
    expect(out.title).toEqual({ ru: 'Установить' })
  })

  it('без идентичности в прошлой версии переносить нечего', () => {
    const [out] = carryTranslations([next()], [prev({ blockId: null })])
    expect(out.title).toEqual({ ru: 'Установить' })
  })

  it('подпункты и подписи ссылок переносятся по позиции', () => {
    const [out] = carryTranslations(
      [next({ subtasks: [{ ru: 'Раз' }], refs: [{ label: { ru: 'Док' } }] })],
      [prev({ subtasks: [{ ru: 'Раз', en: 'One' }], refs: [{ label: { ru: 'Док', en: 'Docs' } }] })],
    )
    expect(out.subtasks).toEqual([{ ru: 'Раз', en: 'One' }])
    expect(out.refs[0].label).toEqual({ ru: 'Док', en: 'Docs' })
  })

  it('переставленные подпункты чужой перевод не забирают', () => {
    const [out] = carryTranslations(
      [next({ subtasks: [{ ru: 'Два' }, { ru: 'Раз' }] })],
      [prev({ subtasks: [{ ru: 'Раз', en: 'One' }, { ru: 'Два', en: 'Two' }] })],
    )
    expect(out.subtasks).toEqual([{ ru: 'Два' }, { ru: 'Раз' }])
  })

  /** Врезка лежит в content строкой — языка интерфейса тут взять негде. */
  it('markdown-врезка сохраняет языки, пока текст тот же', () => {
    const [out] = carryTranslations(
      [next({ type: 'text', content: { md: '# Заголовок', bid: 'b1' } })],
      [prev({ type: 'text', content: { md: { ru: '# Заголовок', en: '# Title' } } })],
    )
    expect(out.content?.md).toEqual({ ru: '# Заголовок', en: '# Title' })
  })

  it('переписанная врезка переводы теряет', () => {
    const [out] = carryTranslations(
      [next({ type: 'text', content: { md: '# Другое', bid: 'b1' } })],
      [prev({ type: 'text', content: { md: { ru: '# Заголовок', en: '# Title' } } })],
    )
    expect(out.content?.md).toBe('# Другое')
  })

  it('содержимое опроса не трогает', () => {
    const content = { question: 'Which?', options: [], bid: 'b1' }
    const [out] = carryTranslations([next({ type: 'poll', content })], [prev({ type: 'poll', content: {} })])
    expect(out.content).toEqual(content)
  })
})
