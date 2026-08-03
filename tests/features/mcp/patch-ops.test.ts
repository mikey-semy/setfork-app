import { describe, expect, it } from 'vitest'
import { applyPatchOps, patchFields, type McpPatchOp, type PatchIO } from '@/features/mcp/patch'
import type { McpItemInput } from '@/features/mcp/tools'

// Порядок блоков — забота applyPatchOps; ЧТО такое блок и как накладывается
// правка, задаёт вызывающий. В тестах представление простейшее (плоский блок),
// боевое (доменные строки с переводами) проверяется на живой БД.
const io: PatchIO<McpItemInput> = {
  bidOf: (b) => b.bid,
  update: (b, op: McpPatchOp) => ({ ...b, ...patchFields(op) }),
  create: (block) => ({ ...block }),
}

// Точечная правка: агент шлёт дельту, состав блоков берётся с сервера. Проверяем
// именно то, ради чего инструмент заведён: соседей патч не трогает, а ошибка в
// любой операции отменяет ВЕСЬ патч (половина применённого хуже неприменённого).
const list = (): McpItemInput[] => [
  { bid: 'a', type: 'step', title: 'install', command: 'winget install X', subtasks: ['runs'] },
  { bid: 'b', type: 'text', text: 'врезка' },
  { bid: 'c', type: 'step', title: 'configure' },
]

const ids = (r: { items: McpItemInput[] } | { error: string }) => ('items' in r ? r.items.map((b) => b.bid) : r.error)

describe('applyPatchOps — update', () => {
  it('меняет только переданные поля, остальные у блока остаются', () => {
    const r = applyPatchOps(list(), [{ op: 'update', bid: 'a', title: 'Установить X' }], io)
    expect('items' in r && r.items[0]).toMatchObject({ bid: 'a', title: 'Установить X', command: 'winget install X', subtasks: ['runs'] })
  })
  it('соседние блоки не трогает', () => {
    const r = applyPatchOps(list(), [{ op: 'update', bid: 'b', text: 'другая врезка' }], io)
    expect('items' in r && r.items[0]).toEqual(list()[0])
    expect('items' in r && r.items[2]).toEqual(list()[2])
  })
  it('undefined в поле не стирает содержимое (клиент сериализовал пропуск)', () => {
    const r = applyPatchOps(list(), [{ op: 'update', bid: 'a', title: 'Ставим X', command: undefined }], io)
    expect('items' in r && r.items[0].command).toBe('winget install X')
  })
  it('неизвестный bid → ошибка с номером операции', () => {
    const r = applyPatchOps(list(), [{ op: 'update', bid: 'nope', title: 'x' }], io)
    expect(r).toEqual({ error: expect.stringContaining('op #1') })
    expect(r).toEqual({ error: expect.stringContaining('nope') })
  })
})

describe('applyPatchOps — insert / delete / move', () => {
  it('insert по умолчанию в конец, "start" — в начало, after — за указанным блоком', () => {
    expect(ids(applyPatchOps(list(), [{ op: 'insert', block: { bid: 'n', type: 'text', text: 'x' } }], io))).toEqual(['a', 'b', 'c', 'n'])
    expect(ids(applyPatchOps(list(), [{ op: 'insert', after: 'start', block: { bid: 'n' } }], io))).toEqual(['n', 'a', 'b', 'c'])
    expect(ids(applyPatchOps(list(), [{ op: 'insert', after: 'a', block: { bid: 'n' } }], io))).toEqual(['a', 'n', 'b', 'c'])
  })
  it('delete убирает ровно один блок', () => {
    expect(ids(applyPatchOps(list(), [{ op: 'delete', bid: 'b' }], io))).toEqual(['a', 'c'])
  })
  it('move вниз попадает туда, куда просили (позиция считается после изъятия)', () => {
    expect(ids(applyPatchOps(list(), [{ op: 'move', bid: 'a', after: 'c' }], io))).toEqual(['b', 'c', 'a'])
    expect(ids(applyPatchOps(list(), [{ op: 'move', bid: 'c', after: 'start' }], io))).toEqual(['c', 'a', 'b'])
  })
  it('move за самого себя — ошибка, а не тихий no-op', () => {
    expect(applyPatchOps(list(), [{ op: 'move', bid: 'a', after: 'a' }], io)).toEqual({ error: expect.stringContaining('itself') })
  })
  it('insert без блока и неизвестный after — ошибки', () => {
    expect(applyPatchOps(list(), [{ op: 'insert' }], io)).toEqual({ error: expect.stringContaining('block') })
    expect(applyPatchOps(list(), [{ op: 'insert', after: 'zz', block: { bid: 'n' } }], io)).toEqual({ error: expect.stringContaining('zz') })
  })
  it('insert с УЖЕ существующим bid отбивается: две одинаковые идентичности ломают адресацию', () => {
    const r = applyPatchOps(list(), [{ op: 'insert', block: { bid: 'a', title: 'копия' } }], io)
    expect(r).toEqual({ error: expect.stringContaining('already exists') })
  })
})

describe('applyPatchOps — весь патч целиком', () => {
  it('операции применяются по порядку', () => {
    const r = applyPatchOps(list(), [
      { op: 'delete', bid: 'b' },
      { op: 'insert', after: 'a', block: { bid: 'n' } },
      { op: 'move', bid: 'c', after: 'start' },
    ], io)
    expect(ids(r)).toEqual(['c', 'a', 'n'])
  })
  it('ошибка в середине отменяет ВЕСЬ патч — вернулась ошибка, а не полусписок', () => {
    const r = applyPatchOps(list(), [
      { op: 'update', bid: 'a', title: 'ок' },
      { op: 'delete', bid: 'missing' },
    ], io)
    expect(r).toEqual({ error: expect.stringContaining('op #2') })
  })
  it('пустые ops и патч, опустошающий список, отбиваются', () => {
    expect(applyPatchOps(list(), [], io)).toEqual({ error: expect.stringContaining('empty') })
    const wipe = applyPatchOps(list(), [{ op: 'delete', bid: 'a' }, { op: 'delete', bid: 'b' }, { op: 'delete', bid: 'c' }], io)
    expect(wipe).toEqual({ error: expect.stringContaining('empty') })
  })
  it('входной массив не мутируется (патч не применился к прочитанному состоянию)', () => {
    const src = list()
    applyPatchOps(src, [{ op: 'update', bid: 'a', title: 'изменено' }, { op: 'delete', bid: 'b' }], io)
    expect(src).toEqual(list())
  })
})
