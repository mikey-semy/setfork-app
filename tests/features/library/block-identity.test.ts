import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { steps } from '@/shared/db/schema'
import {
  CONTENT_FIELDS,
  blockFingerprint,
  blockMatchKey,
  lastChangedVersions,
  matchBlocks,
  type HistoryBlock,
} from '@/features/library/block-identity'

// Blame отвечает на вопрос «когда этот пункт трогали в последний раз». Ошибка здесь
// не косметическая: пользователь считает свежим то, что не менялось годами, и наоборот.
// Проверяются оба правила, на которых ответ держится, — сопоставление блоков сквозь
// версии и полнота отпечатка содержимого.

const block = (over: Partial<HistoryBlock> = {}): HistoryBlock => ({
  type: 'step',
  content: {},
  title: {},
  desc: {},
  command: '',
  level: 'required',
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  hasImage: false,
  imageKey: null,
  needsHuman: false,
  needsHumanAsk: {},
  ...over,
})

const step = (title: string, over: Partial<HistoryBlock> = {}) => block({ title: { ru: title }, ...over })

/** Версии по порядку: v1 = первый набор блоков. */
const history = (...versions: HistoryBlock[][]) => versions.map((blocks, i) => ({ version: i + 1, blocks }))

describe('отпечаток содержимого блока', () => {
  it('перечень полей отпечатка совпадает со схемой блока', () => {
    // Источник истины — схема. Новая колонка содержимого, забытая в отпечатке, —
    // это правка, которую blame перестанет замечать; тест обязан упасть раньше.
    const identityAndOrder = ['id', 'versionId', 'blockId', 'n']
    const contentColumns = Object.keys(getTableColumns(steps)).filter((c) => !identityAndOrder.includes(c))
    expect([...contentColumns].sort()).toEqual([...CONTENT_FIELDS].sort())
  })

  it('не зависит от порядка ключей в jsonb', () => {
    const a = block({ title: { ru: 'Хлеб', en: 'Bread' }, content: { md: 'x', caption: 'y' } })
    const b = block({ title: { en: 'Bread', ru: 'Хлеб' }, content: { caption: 'y', md: 'x' } })
    expect(blockFingerprint(a)).toBe(blockFingerprint(b))
  })

  it.each([
    ['content презентационного блока', block({ type: 'text', content: { md: 'было' } }), block({ type: 'text', content: { md: 'стало' } })],
    ['вариант опроса', block({ type: 'poll', content: { question: 'q', options: [{ text: 'a' }] } }), block({ type: 'poll', content: { question: 'q', options: [{ text: 'b' }] } })],
    ['вопрос теста', block({ type: 'quiz', content: { question: 'сколько?' } }), block({ type: 'quiz', content: { question: 'сколько именно?' } })],
    ['вложенный файл', block({ type: 'file', content: { key: 'a.pdf' } }), block({ type: 'file', content: { key: 'b.pdf' } })],
    ['ссылка на видео', block({ type: 'video', content: { url: 'v1' } }), block({ type: 'video', content: { url: 'v2' } })],
    ['тип блока', block({ type: 'text', content: { md: 'x' } }), block({ type: 'video', content: { md: 'x' } })],
    ['изображение шага', step('Замесить', { hasImage: true, imageKey: 'a.png' }), step('Замесить', { hasImage: true, imageKey: 'b.png' })],
    ['пометка «нужен человек»', step('Купить'), step('Купить', { needsHuman: true })],
    ['вопрос к человеку', step('Купить', { needsHuman: true }), step('Купить', { needsHuman: true, needsHumanAsk: { ru: 'почём у вас?' } })],
    ['уровень шага', step('Купить'), step('Купить', { level: 'optional' })],
    ['перевод заголовка', step('Купить'), step('Купить', { title: { ru: 'Купить', en: 'Buy' } })],
  ])('изменение поля «%s» видно в отпечатке', (_name, before, after) => {
    expect(blockFingerprint(before)).not.toBe(blockFingerprint(after))
  })
})

describe('сопоставление блоков', () => {
  it('идентичность важнее позиции: вставка в начало не сдвигает соответствие', () => {
    const a = block({ blockId: 'a', title: { ru: 'A' } })
    const b = block({ blockId: 'b', title: { ru: 'B' } })
    const x = block({ blockId: 'x', title: { ru: 'X' } })
    const m = matchBlocks([a, b], [x, a, b], (s) => s.blockId, blockMatchKey)
    expect(m[0]).toBeNull()
    expect(m[1]).toMatchObject({ i: 0, byIdentity: true })
    expect(m[2]).toMatchObject({ i: 1, byIdentity: true })
  })

  it('одна старая строка не достаётся двум новым блокам', () => {
    const a = step('Одинаковый')
    const m = matchBlocks([a], [step('Одинаковый'), step('Одинаковый')], (s) => s.blockId, blockMatchKey)
    expect(m[0]).toMatchObject({ i: 0, byIdentity: false })
    expect(m[1]).toBeNull()
  })

  it('блок со своей идентичностью не отбирает источник у блока с чужой', () => {
    // Смешанные данные: часть блоков ещё без blockId. Новый блок с тем же
    // заголовком не должен «занять» источник, у которого идентичность своя.
    const old = block({ blockId: 'old', title: { ru: 'Повторить' } })
    const legacy = block({ title: { ru: 'Хвост' } })
    const fresh = block({ blockId: 'new', title: { ru: 'Повторить' } })
    const m = matchBlocks([old, legacy], [fresh, old, legacy], (s) => s.blockId, blockMatchKey)
    expect(m[0]).toBeNull() // новый блок — новый, а не «переименованный old»
    expect(m[1]).toMatchObject({ i: 0, byIdentity: true })
    expect(m[2]).toMatchObject({ i: 1, byIdentity: false })
  })

  it('блок без идентичности всё ещё сопоставляется с источником, у которого она есть', () => {
    // Обратный ход: запись, потерявшая blockId (перевод, импорт), не должна
    // читаться как «старое удалено, новое добавлено».
    const withId = block({ blockId: 'a', title: { ru: 'A' } })
    const idless = block({ title: { ru: 'A' } })
    const m = matchBlocks([withId], [idless], (s) => s.blockId, blockMatchKey)
    expect(m[0]).toMatchObject({ i: 0, byIdentity: false })
  })

  it('презентационные блоки без идентичности различаются по содержимому, а не по пустому заголовку', () => {
    const t1 = block({ type: 'text', content: { md: 'первый' } })
    const t2 = block({ type: 'text', content: { md: 'второй' } })
    const t3 = block({ type: 'text', content: { md: 'новый' } })
    const m = matchBlocks([t1, t2], [t3, t1, t2], (s) => s.blockId, blockMatchKey)
    expect(m[0]).toBeNull()
    expect(m[1]).toMatchObject({ i: 0 })
    expect(m[2]).toMatchObject({ i: 1 })
  })
})

describe('когда блок менялся в последний раз', () => {
  it('вставка блока не делает соседей изменёнными', () => {
    const a = step('A', { blockId: 'a' })
    const b = step('B', { blockId: 'b' })
    const x = step('X', { blockId: 'x' })
    expect(lastChangedVersions(history([a, b], [x, a, b]))).toEqual([2, 1, 1])
  })

  it('удаление блока не делает соседей изменёнными', () => {
    const a = step('A', { blockId: 'a' })
    const b = step('B', { blockId: 'b' })
    const c = step('C', { blockId: 'c' })
    expect(lastChangedVersions(history([a, b, c], [a, c]))).toEqual([1, 1])
  })

  it('перестановка меняет порядок, но не дату последней правки', () => {
    const a = step('A', { blockId: 'a' })
    const b = step('B', { blockId: 'b' })
    const c = step('C', { blockId: 'c' })
    expect(lastChangedVersions(history([a, b, c], [c, a, b]))).toEqual([1, 1, 1])
  })

  it('переименование с той же идентичностью — это изменение', () => {
    const a = step('A', { blockId: 'a' })
    const renamed = step('A новое', { blockId: 'a' })
    const b = step('B', { blockId: 'b' })
    expect(lastChangedVersions(history([a, b], [renamed, b]))).toEqual([2, 1])
  })

  it('два блока с одинаковым заголовком и разной идентичностью не склеиваются', () => {
    const one = step('Повторить', { blockId: 'one' })
    const two = step('Повторить', { blockId: 'two' })
    const twoChanged = step('Повторить', { blockId: 'two', command: 'make' })
    expect(lastChangedVersions(history([one, two], [one, twoChanged]))).toEqual([1, 2])
  })

  it('новая версия без правки блока его дату не двигает, правка — двигает', () => {
    const t = block({ blockId: 't', type: 'text', content: { md: 'было' } })
    const same = block({ blockId: 't', type: 'text', content: { md: 'было' } })
    const changed = block({ blockId: 't', type: 'text', content: { md: 'стало' } })
    expect(lastChangedVersions(history([t], [same]))).toEqual([1])
    expect(lastChangedVersions(history([t], [same], [changed]))).toEqual([3])
  })

  it('данные без идентичности используют фолбэк по подписи, а не позицию', () => {
    // Версии, записанные до появления block_id: заголовок остаётся единственным
    // способом узнать блок, но и он не должен ехать вслед за вставкой.
    const a = step('A')
    const b = step('B')
    const x = step('X')
    expect(lastChangedVersions(history([a, b], [x, a, b]))).toEqual([2, 1, 1])
  })

  it('появление идентичностей поверх старых данных не читается как «список переписан»', () => {
    const a = step('A')
    const b = step('B')
    const withIds = [step('A', { blockId: 'a' }), step('B', { blockId: 'b' })]
    expect(lastChangedVersions(history([a, b], withIds))).toEqual([1, 1])
  })

  it('блок, исчезавший в пустой версии, считается изменённым при возврате', () => {
    const a = step('A', { blockId: 'a' })
    expect(lastChangedVersions(history([a], [], [a]))).toEqual([3])
  })

  it('пустая история даёт пустой ответ', () => {
    expect(lastChangedVersions([])).toEqual([])
  })
})
