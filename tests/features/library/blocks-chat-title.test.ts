import { describe, expect, it } from 'vitest'
import { blockChatTitle, isBlockUuid, newBlockId } from '@/features/library/blocks'
import { toProposedItems, emptyBlock } from '@/features/library/editor'

// Подпись блока в шапке чата раскопки. Содержимое блока НЕ разбираем: первой
// строкой markdown может быть картинка, таблица или код — подпись берётся из
// структуры (заголовок шага → секция урока → тип блока).
describe('blockChatTitle', () => {
  it('у шага — его заголовок', () => {
    expect(blockChatTitle('step', 'Установить VS Code', 'Редактор', 'ru')).toBe('Установить VS Code')
  })
  it('у блока без заголовка — секция урока', () => {
    expect(blockChatTitle('text', '', 'Редактор', 'ru', '**Внутренний заголовок**')).toBe('Редактор')
  })
  it('у text-блока без метаданных — первая читаемая Markdown-строка', () => {
    expect(blockChatTitle('text', '', '', 'en', '**Глава 4. Реконструкция преступления**\n\nДетектив вошёл в лог.')).toBe(
      'Глава 4. Реконструкция преступления',
    )
    expect(blockChatTitle('text', '', '', 'en', '# Investigation chapter')).toBe('Investigation chapter')
  })
  it('служебные Markdown-строки не превращает в заголовок чата', () => {
    const md = '![diagram](scheme.png)\n\n```bash\necho secret\n```\n\n[Разбор улик](https://example.com)'
    expect(blockChatTitle('text', '', '', 'ru', md)).toBe('Разбор улик')
  })
  it('без заголовка и секции — имя типа на языке зрителя', () => {
    expect(blockChatTitle('text', '', '', 'ru')).toBe('Текст')
    expect(blockChatTitle('text', '', '', 'en')).toBe('Text')
  })
  it('пробельные значения не считаются подписью', () => {
    expect(blockChatTitle('text', '   ', '  ', 'en')).toBe('Text')
  })
})

// steps.block_id — колонка uuid, и значение туда приходит в том числе снаружи (API).
// Мусор в ней роняет ВСТАВКУ шагов, а у черновика вставка идёт после удаления
// старых: падение оставляло бы список без единого блока.
describe('идентичность блока годится для колонки uuid', () => {
  it('newBlockId всегда даёт uuid — в том числе запасным генератором', () => {
    expect(isBlockUuid(newBlockId())).toBe(true)
  })
  it('легаси-bid (не uuid) в канон не попадает — блок получает свежий uuid', () => {
    const items = toProposedItems([{ ...emptyBlock('step'), bid: 'b7x3k9qz', title: 'шаг' }], 'ru')
    expect(isBlockUuid(items[0].blockId)).toBe(true)
    expect(items[0].blockId).not.toBe('b7x3k9qz')
  })
  it('uuid, пришедший снаружи, сохраняется как есть (это и есть идентичность)', () => {
    const bid = newBlockId()
    const items = toProposedItems([{ ...emptyBlock('step'), bid, title: 'шаг' }], 'ru')
    expect(items[0].blockId).toBe(bid)
  })
})
