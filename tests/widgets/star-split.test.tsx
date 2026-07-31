import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

/**
 * ЗВЕЗДА И СЧЁТЧИК ЖИВУТ ОДНИМ СОСТОЯНИЕМ.
 *
 * Счётчик рисует обёртка (общая анатомия сплитов), поэтому легко получить два источника
 * правды: иконка со своим оптимистичным состоянием и число со своим. Так и было: экшен
 * мог завершиться, ничего не изменив (список скрыт или удалён после рендера) — иконка
 * откатывалась сама, а число оставалось сдвинутым до перезагрузки страницы (P2 из
 * авто-ревью).
 *
 * Тест держит правило: пока действие идёт — сдвинуты ОБА, а когда оно завершилось ничем —
 * ОБА возвращаются к серверному значению.
 */
vi.mock('@/features/library/actions', () => ({
  // Экшен «отработал вхолостую»: ничего не поменял и новых пропов не принёс.
  toggleStar: vi.fn(async () => {}),
}))
vi.mock('@/features/star-folders/StarFolderMenu', () => ({
  StarFolderMenu: () => <button type="button">папки</button>,
}))
vi.mock('@/shared/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))

const { StarSplit } = await import('@/widgets/StarSplit')

const filled = () => document.querySelector('svg.lucide-star')?.getAttribute('fill') === 'currentColor'
const counter = () => screen.queryByText(/^\d+$/)?.textContent ?? null

describe('звезда и её счётчик', () => {
  it('на клике сдвигаются вместе, а после холостого действия вместе же откатываются', async () => {
    const user = userEvent.setup()
    render(<StarSplit templateId="t1" starred={false} count={10} label="Отметить" folders={[]} inFolders={[]} lang="ru" />)

    expect(filled()).toBe(false)
    expect(counter()).toBe('10')

    await user.click(screen.getByRole('button', { name: 'Отметить' }))

    // Действие завершилось, ничего не изменив: серверные пропы прежние — значит и звезда,
    // и число обязаны вернуться к ним. Раньше число застревало на 11.
    await waitFor(() => {
      expect(filled()).toBe(false)
      expect(counter()).toBe('10')
    })
  })

  it('нулевой счётчик не рисуется — пустой сегмент не занимает место', () => {
    render(<StarSplit templateId="t2" starred={false} count={0} label="Отметить" folders={[]} inFolders={[]} lang="ru" />)
    expect(counter()).toBeNull()
  })
})
