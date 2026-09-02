import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeSurface } from '@/shared/ui/CodeSurface'
import { TooltipProvider } from '@/shared/ui/Tooltip'

/**
 * ТУМБЛЕР ПЕРЕНОСА НА САМОМ БЛОКЕ.
 *
 * Прокрутка по умолчанию — форма большинства для кода в статьях (GitHub, GitLab, Gitea,
 * Stack Overflow, dev.to, Docusaurus). Но прокрутка БЕЗ выхода и есть то, на что
 * жалуются, поэтому продукты, думавшие дольше прочих, дали читателю тумблер: GitHub в
 * просмотре файла и Docusaurus кнопкой на блоке. Настройкой аккаунта это не является
 * ни у кого — значит и у нас живёт на блоке.
 */
const LINES = [[{ text: 'for _, c := range checks {', cls: '' }], [{ text: '}', cls: '' }]]

/** Ширина в jsdom всегда нулевая: подменяем ровно то, что меряет компонент. */
const setScrollable = (yes: boolean) => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => (yes ? 900 : 100) })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 })
}

const surface = () =>
  render(
    <TooltipProvider delay={0}>
      <CodeSurface code={'for _, c := range checks {\n}'} label="go" lines={LINES} lang="en" />
    </TooltipProvider>,
  )

describe('перенос строк в блоке кода', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it('кнопки нет, пока код влезает: переносить нечего', async () => {
    setScrollable(false)
    surface()
    await waitFor(() => expect(screen.getByLabelText('Copy')).toBeInTheDocument())
    expect(screen.queryByLabelText('Wrap lines')).toBeNull()
  })

  it('кнопка появляется, когда код НЕ влезает — по измерению, а не по догадке', async () => {
    setScrollable(true)
    surface()
    expect(await screen.findByLabelText('Wrap lines')).toBeInTheDocument()
  })

  it('кнопка видна без наведения: на тач-экране скрытый контрол не найти', async () => {
    setScrollable(true)
    surface()
    const btn = await screen.findByLabelText('Wrap lines')
    expect(btn.className, 'opacity-0 до hover — заявка Docusaurus #10821, у нас так нельзя').not.toMatch(/opacity-0/)
  })

  it('включённый перенос рвёт по возможности, а не посреди идентификатора', async () => {
    setScrollable(true)
    const user = userEvent.setup()
    const { container } = surface()
    await user.click(await screen.findByLabelText('Wrap lines'))

    const text = container.querySelector('span:last-child') as HTMLElement
    expect(text.className).toMatch(/whitespace-pre-wrap/)
    expect(text.className).toMatch(/overflow-wrap:anywhere/)
    expect(text.className, 'break-all рубит идентификатор посреди токена — так у Forgejo').not.toMatch(/break-all/)
  })

  it('выбор помнится: разбор состоит из десятка блоков', async () => {
    setScrollable(true)
    const user = userEvent.setup()
    const first = surface()
    await user.click(await screen.findByLabelText('Wrap lines'))
    expect(window.localStorage.getItem('sf:code-wrap')).toBe('1')
    first.unmount()

    surface()
    expect(await screen.findByLabelText('No wrap'), 'состояние сбросилось — как у Docusaurus').toBeInTheDocument()
  })

  it('при включённом переносе кнопка остаётся: иначе его нечем выключить', async () => {
    window.localStorage.setItem('sf:code-wrap', '1')
    setScrollable(false)
    surface()
    expect(await screen.findByLabelText('No wrap')).toBeInTheDocument()
  })
})
