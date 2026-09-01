import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationCandidate } from '@/shared/db'

vi.mock('@/shared/ui/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const { CandidateCard } = await import('@/features/generation/CandidateCard')

/**
 * КАРТОЧКА КАНДИДАТА — САМА КНОПКА, И ВНУТРИ НЕЁ НЕ ДОЛЖНО БЫТЬ ТОЧЕК ОСТАНОВКИ.
 *
 * Содержимое `<button>` не вправе иметь собственный `tabindex`: разметка становится
 * невалидной, а обход с клавиатуры — непредсказуемым. Попались на этом, добавив
 * фокусируемость прокручиваемому блоку команды ради WCAG 2.1.1: правило верное, но
 * ровно здесь неприменимое (находка авто-ревью #850). Проверяем не пропсы, а живой
 * DOM: пропс могут снять, а дефект вернётся молча.
 */
const cand = {
  id: 'c-1',
  idx: 1,
  title: 'Поднять окружение',
  desc: 'Черновик из совета',
  summary: '',
  tags: [],
  items: [
    {
      type: 'step',
      title: 'Запустить',
      desc: '',
      command: 'docker run --rm -v /very/long/path alpine sh',
      subtasks: [],
      refs: [],
    },
  ],
} as unknown as GenerationCandidate

describe('карточка кандидата', () => {
  it('внутри кнопки нет ни одной точки остановки клавиатуры', async () => {
    render(<CandidateCard cand={cand} selected={false} onSelect={() => {}} lang="ru" />)
    const card = screen.getAllByRole('button')[0]
    expect(card.tagName).toBe('BUTTON')
    const inner = card.querySelectorAll('[tabindex]:not([tabindex="-1"])')
    expect(
      [...inner].map((e) => `${e.tagName.toLowerCase()}[tabindex=${e.getAttribute('tabindex')}]`),
      'вложенный фокус внутри <button> — невалидная разметка и сломанный обход',
    ).toEqual([])
  })

  it('команда при этом видна целиком: её прокручивают, а не режут', () => {
    render(<CandidateCard cand={cand} selected={false} onSelect={() => {}} lang="ru" />)
    const code = document.querySelector('code') as HTMLElement
    expect(code.textContent).toBe('docker run --rm -v /very/long/path alpine sh')
    expect(code.className).toMatch(/overflow-x-auto/)
    expect(code.className).not.toMatch(/truncate/)
  })
})
