import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SuggestionResult } from '@/features/library/SuggestionResult'
import { TextBlockBody } from '@/features/library/list-editor/MediaBlocks'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { renderListBlock } from '@/app/[handle]/[slug]/ListBlock'
import type { ProposedItem } from '@/shared/db'

// Ссылки-источники текстового блока там, где их видит АВТОР до сохранения (#962,
// находки Codex на #963): предпросмотр правки и форма самого блока.

const textItem = (md: string): ProposedItem =>
  ({
    type: 'text',
    content: { md },
    title: {},
    desc: {},
    command: '',
    hasImage: false,
    level: 'required',
    why: {},
    section: {},
    subtasks: [],
    refs: [{ label: { ru: 'Декрет — текст' }, url: 'https://ru.wikisource.org/wiki/a' }],
  }) as unknown as ProposedItem

describe('предпросмотр правки', () => {
  it('показывает ссылки текста под его словами', () => {
    render(<SuggestionResult items={[textItem('Первый документ.')]} lang="ru" />)
    expect(screen.getByText('Первый документ.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Декрет — текст' }).getAttribute('href')).toBe('https://ru.wikisource.org/wiki/a')
  })

  it('текст только со ссылками — не пустая карточка', () => {
    render(<SuggestionResult items={[textItem('')]} lang="ru" />)
    expect(screen.getByRole('link', { name: 'Декрет — текст' })).toBeTruthy()
  })
})

describe('слэш-меню текстового блока', () => {
  const body = (refs: { label: string; url: string }[]) => (
    <TooltipProvider>
      <TextBlockBody value="/" onChange={() => {}} refs={refs} onRefsChange={() => {}} onRetype={() => {}} lang="ru" />
    </TooltipProvider>
  )

  it('в пустом блоке «/» открывает выбор типа', () => {
    // Контроль: без него «меню не открылось» ниже доказывало бы только то, что
    // меню не открывается вовсе.
    render(body([]))
    expect(screen.queryByRole('listbox')).not.toBeNull()
  })

  it('в тексте со ссылками «/» НЕ открывает смену типа — она выбросила бы источники', () => {
    render(body([{ label: 'Декрет — текст', url: 'https://ru.wikisource.org/wiki/a' }]))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('текст только со ссылками на странице списка', () => {
  // Находка Codex на #963: без слов ряд ссылок — первое в карточке, и справа сверху
  // у читателя с правом раскопки лежит кнопка кирки. Длинная ссылка уходила под неё.
  const block = (viewer: { id: string } | null) =>
    renderListBlock({
      step: { id: 's1', n: 1, type: 'text', content: { md: '' }, refs: [{ label: { ru: 'Декрет — текст' }, url: 'https://ru.wikisource.org/wiki/a' }] },
      section: '',
      tpl: { id: 't1' },
      viewer,
      readOnlyView: false,
      digSteps: new Set<number>(),
      mon: { linkTracking: false },
      lang: 'ru',
    } as unknown as Parameters<typeof renderListBlock>[0])
  const row = () => screen.getByRole('link', { name: 'Декрет — текст' }).parentElement!

  it('с киркой ряд ссылок оставляет её угол свободным', () => {
    render(<TooltipProvider>{block({ id: 'u1' })}</TooltipProvider>)
    expect(row().className).toContain('pr-10')
  })

  it('без кирки угол не резервируется', () => {
    // Контроль: иначе «pr-10 есть» выше доказывало бы только, что он есть всегда.
    render(<TooltipProvider>{block(null)}</TooltipProvider>)
    expect(row().className).not.toContain('pr-10')
  })
})
