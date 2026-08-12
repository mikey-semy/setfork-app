import { describe, expect, it } from 'vitest'
import { patchBlock, rowsToProposed } from '@/features/mcp/tools/lists/patch-block'
import type { McpPatchOp } from '@/features/mcp/patch'
import type { ProposedItem } from '@/shared/db'
import type { DetailStep } from '@/features/mcp/tools/shared'

// Наложение плоской формы MCP на доменный блок — самое тонкое место записи через
// API: агент видит ОДИН язык и шлёт ОДНО поле, а в базе лежат словари переводов,
// картинки и содержимое типов, которых плоская форма не знает. До сих пор это
// проверялось только на живой БД (tools.itest.ts), хотя функция чистая.
//
// Каждый тест ниже — про потерю данных, которая уже случалась: комментарии в
// самом модуле перечисляют их поимённо.

const step = (over: Partial<Record<string, unknown>> = {}): ProposedItem =>
  ({
    blockId: 'a',
    type: 'step',
    content: {},
    title: { en: 'install', ru: 'установить' },
    desc: {},
    command: '',
    hasImage: false,
    level: 'required',
    why: {},
    section: {},
    needsHuman: false,
    subtasks: [],
    refs: [],
    ...over,
  }) as unknown as ProposedItem

const update = (item: ProposedItem, fields: Partial<McpPatchOp>) => patchBlock(item, { op: 'update', bid: 'a', ...fields } as McpPatchOp)
const ok = (r: ProposedItem | { error: string }) => {
  if ('error' in r) throw new Error(`ожидался блок, пришёл отказ: ${r.error}`)
  return r as unknown as Record<string, unknown>
}

describe('patchBlock — переводы', () => {
  it('кладёт правку в ту локаль, ОТКУДА чтение взяло показанное значение', () => {
    // get_list отдаёт en, значит правка обязана лечь в en. Ляг она в ru —
    // наружу продолжил бы отдаваться прежний английский, и правка выглядела бы
    // принятой, но не видной.
    const out = ok(update(step(), { title: 'set up' }))
    expect(out.title).toEqual({ en: 'set up', ru: 'установить' })
  })

  it('очистка убирает ТОЛЬКО показанную локаль, а не словарь целиком', () => {
    const out = ok(update(step({ desc: { en: 'english', ru: 'русское' } }), { desc: '' }))
    expect(out.desc).toEqual({ ru: 'русское' })
  })

  it('непереданные поля переживают патч', () => {
    const before = step({ desc: { en: 'why it matters' }, command: 'winget install X', imageKey: 'k/1.png', hasImage: true })
    const out = ok(update(before, { title: 'set up' }))
    expect(out.desc).toEqual({ en: 'why it matters' })
    expect(out.command).toBe('winget install X')
    expect(out.imageKey).toBe('k/1.png')
  })
})

describe('patchBlock — пометка «нужен человек»', () => {
  it('снятая пометка уносит и вопрос', () => {
    // Иначе get_list продолжал бы отдавать вопрос при снятой пометке, а
    // повторное включение воскрешало бы старый.
    const before = step({ needsHuman: true, needsHumanAsk: { en: 'which drive?' } })
    const out = ok(update(before, { needsHuman: false }))
    expect(out.needsHuman).toBe(false)
    expect(out.needsHumanAsk).toEqual({})
  })

  it('вопрос без правки пометки остаётся на месте', () => {
    const before = step({ needsHuman: true, needsHumanAsk: { en: 'which drive?' } })
    const out = ok(update(before, { title: 'set up' }))
    expect(out.needsHumanAsk).toEqual({ en: 'which drive?' })
  })
})

describe('patchBlock — подпункты и ссылки', () => {
  it('сопоставляет подпункты по ТЕКСТУ, а не по позиции', () => {
    // Вставка в начало сдвигала бы переводы на соседние пункты: русский текст
    // оказывался бы у чужой строки.
    const before = step({ subtasks: [{ en: 'first', ru: 'первый' }, { en: 'second', ru: 'второй' }] })
    const out = ok(update(before, { subtasks: ['zero', 'first', 'second'] }))
    expect(out.subtasks).toEqual([{ en: 'zero' }, { en: 'first', ru: 'первый' }, { en: 'second', ru: 'второй' }])
  })

  it('переносит словарь подписи ссылки, если текст совпал', () => {
    const before = step({ refs: [{ label: { en: 'docs', ru: 'документация' }, url: 'https://example.com' }] })
    const out = ok(update(before, { refs: [{ label: 'docs', url: 'https://example.com/v2' }] }))
    expect(out.refs).toEqual([{ label: { en: 'docs', ru: 'документация' }, url: 'https://example.com/v2' }])
  })
})

describe('patchBlock — content не-step блоков', () => {
  const image = () =>
    ({
      blockId: 'i',
      type: 'image',
      content: { ref: 'k/photo.png', caption: 'подпись', legacyThing: 42 },
      title: {},
      desc: {},
      subtasks: [],
      refs: [],
    }) as unknown as ProposedItem

  it('ЯВНАЯ очистка поля срабатывает, хотя сериализатор пустое опускает', () => {
    // При простом слиянии поверх старого значения такая правка не делала бы
    // ничего, а ответ был бы успешным.
    const out = ok(patchBlock(image(), { op: 'update', bid: 'i', caption: '' } as McpPatchOp))
    expect((out.content as Record<string, unknown>).caption).toBeUndefined()
    expect((out.content as Record<string, unknown>).ref).toBe('k/photo.png')
  })

  it('ключи, которых плоская форма не знает, сохраняются', () => {
    const out = ok(patchBlock(image(), { op: 'update', bid: 'i', caption: 'новая' } as McpPatchOp))
    expect((out.content as Record<string, unknown>).legacyThing).toBe(42)
  })
})

describe('patchBlock — отказы', () => {
  it('пустая операция', () => {
    expect(update(step(), {})).toEqual({ error: 'nothing to update — pass at least one field' })
  })

  it('смена типа блока', () => {
    const r = update(step(), { type: 'text', text: 'врезка' })
    expect('error' in r && r.error).toContain('cannot change block type')
  })

  it('товары через API пока не патчатся', () => {
    const r = patchBlock(step({ type: 'product' }), { op: 'update', bid: 'a', title: 'x' } as McpPatchOp)
    expect(r).toEqual({ error: 'product blocks cannot be patched through the API yet' })
  })

  it('патч, оставляющий шаг без заголовка', () => {
    const r = update(step(), { title: '' })
    expect(r).toEqual({ error: 'the patch would leave the block empty (a step needs a title)' })
  })
})

describe('rowsToProposed', () => {
  it('ведёт нетронутые блоки БЕЗ потерь: словари, content и идентичность как есть', () => {
    // Через плоскую форму эти блоки гонять нельзя — переводы схлопнулись бы в
    // одну строку, а content типов, которых форма не знает, пропал бы.
    const rows = [
      { blockId: 'a', type: 'step', content: {}, title: { en: 'install', ru: 'установить' }, subtasks: [{ en: 'one' }], refs: [], imageKey: 'k/1.png' },
      { blockId: 'b', type: 'product', content: { items: [{ sku: 'X' }] }, title: {}, subtasks: [], refs: [] },
    ] as unknown as DetailStep[]
    const out = rowsToProposed(rows) as unknown as Record<string, unknown>[]
    expect(out[0].title).toEqual({ en: 'install', ru: 'установить' })
    expect(out[0].imageKey).toBe('k/1.png')
    expect(out[1].content).toEqual({ items: [{ sku: 'X' }] })
    expect(out.map((b) => b.blockId)).toEqual(['a', 'b'])
  })
})
