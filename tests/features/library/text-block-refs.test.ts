import { describe, expect, it } from 'vitest'
import { toEditorItems, toProposedItems } from '@/features/library/editor'
import { blockForMcp, toProposed, type DetailStep } from '@/features/mcp/tools/shared'
import { patchBlock } from '@/features/mcp/tools/lists/patch-block'
import type { McpPatchOp } from '@/features/mcp/patch'
import type { ProposedItem } from '@/shared/db'

// Ссылки-источники у ТЕКСТОВОГО блока (#962).
//
// Справочный список — «что сделал такой-то», «вопросы с собеседования» — состоит из
// текстовых блоков, и каждому пункту нужны источники. Хранилище и канон ссылки у
// текста держат, а редактор, показ и MCP их не знали: агент вписывал источники в
// markdown строкой, а положенные в `refs` пропадали молча. Здесь — пути человека и
// агента, на каждом из которых ссылки терялись.

const SOURCE = { label: { ru: 'Декрет о мире — текст' }, url: 'https://ru.wikisource.org/wiki/Декрет_о_мире' }

const textItem = (refs: ProposedItem['refs']): ProposedItem =>
  ({
    type: 'text',
    content: { md: 'Первый документ новой власти.', bid: 'b1' },
    blockId: 'b1',
    title: {},
    desc: {},
    command: '',
    hasImage: false,
    level: 'required',
    why: {},
    section: {},
    subtasks: [],
    refs,
  }) as unknown as ProposedItem

describe('текстовый блок в веб-редакторе', () => {
  it('ссылка текста переживает открытие и сохранение без правок', () => {
    // Было: toProposedItems писал тексту refs: [] безусловно — первое же сохранение
    // в редакторе стирало ссылки, пришедшие через API или git.
    const [saved] = toProposedItems(toEditorItems([textItem([SOURCE])], 'ru'), 'ru')
    expect(saved.refs).toEqual([{ label: { ru: 'Декрет о мире — текст' }, url: SOURCE.url }])
  })

  it('ссылка без подписи у текста тоже живёт — её покажут доменом', () => {
    const [saved] = toProposedItems(toEditorItems([textItem([{ label: {}, url: SOURCE.url }])], 'ru'), 'ru')
    expect(saved.refs).toEqual([{ label: {}, url: SOURCE.url }])
  })

  it('форма редактора получает ссылки текста, а не пустой список', () => {
    const [ed] = toEditorItems([textItem([SOURCE])], 'ru')
    expect(ed.refs).toEqual([{ label: 'Декрет о мире — текст', url: SOURCE.url }])
  })
})

describe('текстовый блок через MCP', () => {
  it('ссылки текста доезжают до записи, а не выбрасываются', () => {
    const [p] = toProposed([{ type: 'text', text: 'Первый документ новой власти.', refs: [{ label: 'Декрет — текст', url: SOURCE.url }] }], 'en')
    expect(p.refs).toEqual([{ label: { en: 'Декрет — текст' }, url: SOURCE.url }])
  })

  it('get_list отдаёт ссылки текста — иначе прочитанное нельзя вернуть как было', () => {
    const out = blockForMcp({ ...textItem([SOURCE]), n: 1 } as unknown as DetailStep, 'en') as Record<string, unknown>
    expect(out.refs).toEqual([{ label: 'Декрет о мире — текст', url: SOURCE.url }])
  })

  it('патч текста через MCP не стирает его ссылки', () => {
    // Непереданное поле обязано остаться КАК БЫЛО — вместе со словарём языков, а не
    // переложенным под en. Держит это движок патча (непереданное берётся у прежнего
    // блока), а не ветка текста: порча записи и чтения ссылок текста этот тест не
    // роняет, проверено. Он закрепляет сквозное поведение, а не правку #962.
    const r = patchBlock(textItem([SOURCE]), { op: 'update', bid: 'b1', text: 'Исправленный текст.' } as McpPatchOp, 'en')
    if ('error' in r) throw new Error(r.error)
    expect(r.refs).toEqual([SOURCE])
  })

  it('ссылки блоку, который их не держит, — отказ с понятным текстом, а не молчание', () => {
    expect(() => toProposed([{ type: 'image', imageRef: 'u/1.png', refs: [{ label: 'источник', url: SOURCE.url }] }], 'en')).toThrow(
      /cannot carry refs — links attach to a step or a text block/,
    )
  })

  it('пустой список ссылок у картинки — не повод отказывать', () => {
    // get_list отдаёт блоки, и агент возвращает их как есть: пустой `refs: []` у
    // картинки — это не попытка приложить источник.
    expect(() => toProposed([{ type: 'image', imageRef: 'u/1.png', refs: [] }], 'en')).not.toThrow()
  })
})
