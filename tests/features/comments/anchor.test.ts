import { describe, it, expect } from 'vitest'
import { makeAnchor, resolveAnchor, CONTEXT_LEN, MIN_SCORE } from '@/features/comments/anchor'

const TEXT = 'Залей желатин 100 мл холодной воды прямо в чаше миксера и оставь набухать на 15–20 минут.'
const at = (text: string, sub: string) => {
  const i = text.indexOf(sub)
  if (i < 0) throw new Error(`подстроки «${sub}» нет в тексте`)
  return makeAnchor(text, i, i + sub.length)
}

describe('makeAnchor', () => {
  it('сохраняет цитату и контекст с обеих сторон', () => {
    const a = at(TEXT, 'холодной воды')
    expect(a.exact).toBe('холодной воды')
    expect(TEXT.slice(a.start, a.end)).toBe('холодной воды')
    expect(a.prefix.length).toBeLessThanOrEqual(CONTEXT_LEN)
    expect(TEXT.startsWith(a.prefix, a.start - a.prefix.length)).toBe(true)
    expect(TEXT.startsWith(a.suffix, a.end)).toBe(true)
  })

  it('обрезает выделение по границам текста', () => {
    const a = makeAnchor('коротко', -5, 999)
    expect(a.exact).toBe('коротко')
    expect(a.start).toBe(0)
    expect(a.end).toBe(7)
  })
})

describe('resolveAnchor — текст не менялся', () => {
  it('находит на прежнем месте с полной уверенностью', () => {
    const a = at(TEXT, 'набухать')
    const r = resolveAnchor(a, TEXT)
    expect(r.state).toBe('anchored')
    if (r.state !== 'orphaned') {
      expect(TEXT.slice(r.start, r.end)).toBe('набухать')
      expect(r.confidence).toBe(1)
    }
  })
})

describe('resolveAnchor — текст правили', () => {
  it('вставка ПЕРЕД цитатой: позиция уехала, цитата цела → якорь жив', () => {
    const a = at(TEXT, 'холодной воды')
    const edited = 'Сначала подготовь посуду. ' + TEXT
    const r = resolveAnchor(a, edited)
    expect(r.state).toBe('anchored') // цитата найдена дословно, просто сдвинулась
    if (r.state !== 'orphaned') expect(edited.slice(r.start, r.end)).toBe('холодной воды')
  })

  it('правка ВНУТРИ цитаты → перепривязан с уверенностью, а не осиротел', () => {
    const a = at(TEXT, 'холодной воды')
    const edited = TEXT.replace('холодной воды', 'холодной кипячёной воды')
    const r = resolveAnchor(a, edited)
    expect(r.state).toBe('reanchored')
    if (r.state === 'reanchored') {
      expect(r.confidence).toBeGreaterThanOrEqual(MIN_SCORE)
      expect(r.confidence).toBeLessThan(1)
      // Вставка длиннее бюджета ошибок (длина/2) не влезает в совпадение целиком,
      // поэтому якорь садится на УЦЕЛЕВШИЙ фрагмент прежней цитаты — это и есть
      // ожидаемое поведение: комментарий остаётся в правильном месте текста.
      expect(edited.slice(r.start, r.end)).toContain('холодной')
    }
  })

  it('мелкая правка внутри цитаты укладывается в бюджет — цитата остаётся целой', () => {
    const a = at(TEXT, 'оставь набухать')
    const edited = TEXT.replace('оставь набухать', 'оставь набухнуть')
    const r = resolveAnchor(a, edited)
    expect(r.state).toBe('reanchored')
    if (r.state === 'reanchored') expect(edited.slice(r.start, r.end)).toBe('оставь набухнуть')
  })

  it('цитату удалили целиком → осиротел', () => {
    const a = at(TEXT, 'оставь набухать на 15–20 минут')
    const edited = 'Залей желатин 100 мл холодной воды прямо в чаше миксера.'
    expect(resolveAnchor(a, edited).state).toBe('orphaned')
  })

  it('текст заменили полностью → осиротел, а не липнет к случайному месту', () => {
    const a = at(TEXT, 'холодной воды')
    expect(resolveAnchor(a, 'Совершенно другой шаг про духовку и противень.').state).toBe('orphaned')
  })

  it('пустой новый текст → осиротел', () => {
    expect(resolveAnchor(at(TEXT, 'желатин'), '').state).toBe('orphaned')
  })
})

describe('resolveAnchor — неоднозначность решается контекстом', () => {
  // Две одинаковые цитаты: без префикса/суффикса выбор был бы произвольным.
  const DUP = 'Помешай венчиком. Добавь сахар. Помешай венчиком. Подожди.'

  it('выбирает то вхождение, вокруг которого совпал контекст', () => {
    const second = DUP.lastIndexOf('Помешай венчиком')
    const a = makeAnchor(DUP, second, second + 'Помешай венчиком'.length)
    const edited = DUP.replace('Добавь сахар', 'Добавь сахар и соль')
    const r = resolveAnchor(a, edited)
    expect(r.state).not.toBe('orphaned')
    if (r.state !== 'orphaned') {
      // Должен указать на ВТОРОЕ вхождение, а не на первое.
      expect(r.start).toBeGreaterThan(edited.indexOf('Помешай венчиком'))
      expect(edited.slice(r.start, r.end)).toBe('Помешай венчиком')
    }
  })
})

describe('resolveAnchor — комментарий к блоку целиком', () => {
  it('пустая цитата всегда привязана (якорь = сам блок)', () => {
    const a = makeAnchor('', 0, 0)
    const r = resolveAnchor(a, 'любой другой текст')
    expect(r.state).toBe('anchored')
  })
})
