import { describe, expect, it } from 'vitest'
import { fieldVerdict, rekeyBlock, rekeyList } from '../../scripts/rekey-lang'

/**
 * ПЕРЕКЛАДКА КЛЮЧЕЙ ЯЗЫКА (ADR-0030).
 *
 * Списки, созданные через MCP до setfork-app#1033, хранят русский текст под `en`. Правило
 * перекладывает только то, где оригинал однозначен: один ключ, и он не язык списка. Список,
 * который переводили, не трогается вовсе: одиночный чужой ключ в нём может оказаться переводом.
 */
const tally = () => ({ moved: 0, ambiguous: 0, translated: 0 })

describe('fieldVerdict', () => {
  it('один чужой ключ — перекладываем', () => {
    expect(fieldVerdict({ en: 'Замочить горох' }, 'ru')).toBe('move')
  })
  it('только ключ языка списка — не трогаем', () => {
    expect(fieldVerdict({ ru: 'Борщ' }, 'ru')).toBe('keep')
  })
  it('ключ языка рядом с другими — поле переведено', () => {
    expect(fieldVerdict({ ru: 'Борщ', en: 'Borscht' }, 'ru')).toBe('translated')
  })
  it('пусто — не трогаем; пустое значение ключом не считается', () => {
    expect(fieldVerdict({}, 'ru')).toBe('keep')
    expect(fieldVerdict(null, 'ru')).toBe('keep')
    expect(fieldVerdict({ en: '' }, 'ru')).toBe('keep')
    expect(fieldVerdict({ ru: 'Борщ', en: '' }, 'ru')).toBe('keep')
  })
  it('два чужих ключа — оригинал не определить', () => {
    expect(fieldVerdict({ ru: 'Борщ', en: 'Borscht' }, 'be')).toBe('ambiguous')
  })
  it('пустой второй ключ не делает поле спорным', () => {
    expect(fieldVerdict({ en: 'Замочить', de: '' }, 'ru')).toBe('move')
  })
})

describe('rekeyBlock', () => {
  it('перекладывает ВСЕ многоязычные поля шага и не теряет остальные', () => {
    const t = tally()
    const out = rekeyBlock(
      {
        title: { en: 'Сварить бульон' },
        desc: { en: 'Два часа' },
        why: { en: 'Иначе мутный' },
        needsHumanAsk: { en: 'Какое мясо?' },
        section: { en: 'Основа' },
        subtasks: [{ en: 'Мясо мягкое' }, { ru: 'Уже под ru' }],
        refs: [{ label: { en: 'Рецепт' }, url: 'https://example.com' }, { url: 'https://example.org' }],
        content: { bid: 'b1' },
        command: 'make soup',
        level: 'required',
      },
      'ru',
      t,
    )
    expect(out).toEqual({
      title: { ru: 'Сварить бульон' },
      desc: { ru: 'Два часа' },
      why: { ru: 'Иначе мутный' },
      needsHumanAsk: { ru: 'Какое мясо?' },
      section: { ru: 'Основа' },
      subtasks: [{ ru: 'Мясо мягкое' }, { ru: 'Уже под ru' }],
      refs: [{ label: { ru: 'Рецепт' }, url: 'https://example.com' }, { url: 'https://example.org' }],
      content: { bid: 'b1' },
      command: 'make soup',
      level: 'required',
    })
    expect(t).toEqual({ moved: 7, ambiguous: 0, translated: 0, sample: 'Сварить бульон' })
  })

  it('берётся НЕПУСТОЕ значение, где бы оно ни стояло', () => {
    expect(rekeyBlock({ title: { de: '', en: 'Замочить' } }, 'ru', tally()).title).toEqual({ ru: 'Замочить' })
  })

  it('текст блока и подпись: объект перекладывается, строка остаётся строкой', () => {
    const t = tally()
    expect(rekeyBlock({ content: { md: { en: 'Абзац' }, bid: 'x' } }, 'ru', t).content).toEqual({ md: { ru: 'Абзац' }, bid: 'x' })
    expect(rekeyBlock({ content: { md: 'Абзац строкой' } }, 'ru', t).content).toEqual({ md: 'Абзац строкой' })
    expect(rekeyBlock({ content: { caption: { en: 'Подпись' } } }, 'ru', t).content).toEqual({ caption: { ru: 'Подпись' } })
    expect(t.moved).toBe(2)
  })
})

describe('rekeyList', () => {
  it('мета отдаётся только если меняется', () => {
    const r = rekeyList({ lang: 'ru', title: { ru: 'Борщ' }, desc: { en: 'Густой' }, blocks: [{ title: { en: 'Сварить' } }] })
    expect(r).toEqual({ blocks: [{ title: { ru: 'Сварить' } }], desc: { ru: 'Густой' }, tally: { moved: 2, ambiguous: 0, translated: 0, sample: 'Сварить' }, held: false })
  })

  it('заголовок списка тоже перекладывается', () => {
    expect(rekeyList({ lang: 'ru', title: { en: 'Борщ' }, desc: {}, blocks: [] }).title).toEqual({ ru: 'Борщ' })
  })

  it('перекладывать нечего — ни меты, ни счёта', () => {
    const r = rekeyList({ lang: 'ru', title: { ru: 'Борщ' }, desc: {}, blocks: [{ title: { ru: 'Сварить' } }] })
    expect(r).toEqual({ blocks: [{ title: { ru: 'Сварить' } }], tally: { moved: 0, ambiguous: 0, translated: 0 }, held: false })
  })

  it('⚠️ переведённый список не трогается ЦЕЛИКОМ: одиночный en в нём может быть переводом', () => {
    const blocks = [{ title: { ru: 'Разогреть духовку', en: 'Preheat the oven' } }, { title: { en: 'Check the oven' } }]
    const r = rekeyList({ lang: 'ru', title: { ru: 'Пирог' }, desc: {}, blocks })
    expect(r.held).toBe(true)
    expect(r.blocks).toBe(blocks)
    expect(r).not.toHaveProperty('title')
  })

  it('спорный заголовок списка — тоже повод не трогать', () => {
    const r = rekeyList({ lang: 'be', title: { ru: 'Борщ', en: 'Borscht' }, desc: {}, blocks: [{ title: { en: 'Зварыць' } }] })
    expect([r.held, r.tally.ambiguous]).toEqual([true, 1])
  })
})
