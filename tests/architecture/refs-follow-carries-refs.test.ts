import { describe, expect, it } from 'vitest'
import { BLOCK_TYPES, carriesRefs } from '@/features/library/blocks'
import { toEditorItems, toProposedItems } from '@/features/library/editor'
import { toProposed } from '@/features/mcp/tools/shared'

// Узда: какие блоки держат ссылки, решено в ОДНОМ месте — `carriesRefs`, — и оба
// пути записи ему подчиняются.
//
// До #962 правило «ссылки есть только у шага» жило неявно в трёх местах сразу:
// в ветке шага редактора, в ветке шага MCP и в описании поля. Добавили бы ссылки
// одному типу в одном месте — два других продолжили бы их выбрасывать, и каждое по
// отдельности выглядело бы верным. Поэтому типы здесь не перечислены руками, а
// берутся из `BLOCK_TYPES`: новый тип блока попадёт под проверку сам.

const URL = 'https://ru.wikisource.org/wiki/Декрет_о_мире'
type StoredItem = Parameters<typeof toEditorItems>[0][number]

describe('ссылки блока подчиняются carriesRefs на обоих путях записи', () => {
  it('типы, держащие ссылки, в списке типов есть — иначе узда проверяет пустоту', () => {
    expect(BLOCK_TYPES.filter(carriesRefs).length).toBeGreaterThan(0)
  })

  for (const type of BLOCK_TYPES.filter(carriesRefs)) {
    it(`${type}: ссылка переживает редактор`, () => {
      const item = {
        type,
        content: type === 'text' ? { md: 'текст', bid: 'b' } : {},
        title: { ru: 'пункт' },
        desc: {},
        command: '',
        hasImage: false,
        subtasks: [],
        refs: [{ label: { ru: 'источник' }, url: URL }],
      } as unknown as StoredItem
      const [saved] = toProposedItems(toEditorItems([item], 'ru'), 'ru')
      expect(saved.refs).toEqual([{ label: { ru: 'источник' }, url: URL }])
    })

    it(`${type}: ссылка переживает запись через MCP`, () => {
      const [p] = toProposed([{ type, title: 'пункт', text: 'текст', refs: [{ label: 'источник', url: URL }] }])
      expect(p.refs).toEqual([{ label: { en: 'источник' }, url: URL }])
    })
  }

  for (const type of BLOCK_TYPES.filter((t) => !carriesRefs(t))) {
    it(`${type}: ссылки через MCP — отказ, а не молчаливая потеря`, () => {
      expect(() => toProposed([{ type, refs: [{ label: 'источник', url: URL }] }])).toThrow(/cannot carry refs/)
    })
  }
})
