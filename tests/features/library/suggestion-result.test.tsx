import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SuggestionResult } from '@/features/library/SuggestionResult'
import { t } from '@/shared/i18n'
import type { ProposedItem } from '@/shared/db'

// Предпросмотр «каким станет список». Проверяем ровно то, ради чего он существует: человек
// должен увидеть РЕЗУЛЬТАТ, а не читать плюсы-минусы диффа — включая пометку «здесь нужен
// человек» (иначе приглашение исчезало бы именно там, где решают, принимать ли правку).

const item = (over: Partial<ProposedItem> = {}): ProposedItem => ({
  title: { ru: 'Замесить тесто' },
  desc: {},
  command: '',
  hasImage: false,
  level: 'required',
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  ...over,
})

describe('итог правки', () => {
  it('нумерует шаги и показывает заголовки', () => {
    render(<SuggestionResult items={[item(), item({ title: { ru: 'Дать подняться' } })]} lang="ru" />)
    expect(screen.getByText('Замесить тесто')).toBeInTheDocument()
    expect(screen.getByText('Дать подняться')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('неупорядоченный список — маркеры вместо номеров', () => {
    render(<SuggestionResult items={[item()]} lang="ru" ordered={false} />)
    expect(screen.getByText('•')).toBeInTheDocument()
  })

  it('пометка «здесь нужен человек» видна с вопросом', () => {
    render(<SuggestionResult items={[item({ needsHuman: true, needsHumanAsk: { ru: 'Сколько стоит мука у вас?' } })]} lang="ru" />)
    expect(screen.getByText(/Сколько стоит мука у вас/)).toBeInTheDocument()
    expect(screen.getByText(`${t('needsHumanLabel', 'ru')}:`)).toBeInTheDocument()
  })

  it('пометка без вопроса — общий текст приглашения, а не пустое место', () => {
    render(<SuggestionResult items={[item({ needsHuman: true })]} lang="ru" />)
    expect(screen.getByText(t('needsHumanGeneric', 'ru'))).toBeInTheDocument()
  })

  it('«зачем», подпункты и ссылки доезжают', () => {
    render(
      <SuggestionResult
        items={[item({ why: { ru: 'Без замеса не поднимется' }, subtasks: [{ ru: 'Тесто отлипает от рук' }], refs: [{ label: { ru: 'ГОСТ' }, url: 'https://example.com' }] })]}
        lang="ru"
      />,
    )
    expect(screen.getByText(/Без замеса не поднимется/)).toBeInTheDocument()
    expect(screen.getByText('Тесто отлипает от рук')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ГОСТ' })).toHaveAttribute('href', 'https://example.com')
  })

  it('текстовый блок рисуется как текст и НЕ получает номера шага', () => {
    render(<SuggestionResult items={[item({ type: 'text', content: { md: 'Просто пояснение' } }), item()]} lang="ru" />)
    expect(screen.getByText('Просто пояснение')).toBeInTheDocument()
    // Шаг после презентационного блока остаётся первым по нумерации.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).toBeNull()
  })
})
