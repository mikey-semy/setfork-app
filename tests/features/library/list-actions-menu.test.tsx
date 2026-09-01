import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/library/actions/versions', () => ({ publishList: vi.fn(async () => {}) }))
vi.mock('@/features/library/actions/ai', () => ({ translateList: vi.fn(async () => ({})) }))
vi.mock('@/shared/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))

const { ListActionsMenu } = await import('@/features/library/ListActionsMenu')

const props = {
  base: '/miki/draft',
  isOwner: true,
  templateId: 'draft-1',
  lang: 'en' as const,
  canTranslate: false,
  canPublish: true,
  targetLang: 'en' as const,
}

/**
 * ⚠️ ГЛАВНОЕ, ЧТО СТЕРЕЖЁТ ЭТОТ ФАЙЛ: подсказка не расходуется впустую. Точка на кнопке
 * раньше гасла в момент открытия меню — ровно тогда, когда человек впервые мог увидеть,
 * о чём она. Внутри его встречал обычный список пунктов.
 */
describe('подсказка о доступном действии', () => {
  beforeEach(() => window.localStorage.clear())

  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    const trigger = await screen.findByRole('button', { name: 'You can publish this list' })
    await waitFor(() => expect(document.querySelector('[data-publish-hint]')).toBeInTheDocument())
    await user.click(trigger)
    return trigger
  }

  it('точка на кнопке расшифрована подписью и лопается от открытия меню', async () => {
    const user = userEvent.setup()
    render(<ListActionsMenu {...props} />)
    const dot = (await waitFor(() => {
      const node = document.querySelector('[data-publish-hint]')
      expect(node).toBeInTheDocument()
      return node
    })) as HTMLElement

    await openMenu(user)

    expect(dot).toHaveClass('animate-sf-hint-burst')
    expect(window.localStorage.getItem('sf:hint-seen:draft-1')).toBe('1')
    await waitFor(() => expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument())
  })

  it('внутри меню помечен САМ пункт — иначе открытие гасит подсказку впустую', async () => {
    const user = userEvent.setup()
    render(<ListActionsMenu {...props} />)
    await openMenu(user)

    const item = await screen.findByRole('menuitem', { name: 'Publish this list' })
    expect(item.querySelector('span[aria-hidden]')).toBeInTheDocument()
    // Правка — обычный пункт: точка стоит только там, где есть что подсказать.
    expect(screen.getByRole('menuitem', { name: 'Edit' }).querySelector('span[aria-hidden]')).toBeNull()
  })

  it('пункт помечен, пока действие не применили: просмотр меню его не гасит', async () => {
    const user = userEvent.setup()
    const first = render(<ListActionsMenu {...props} />)
    await openMenu(user)
    await user.keyboard('{Escape}')
    first.unmount()

    render(<ListActionsMenu {...props} />)
    // Кнопка молчит — меню уже открывали, дёргать месяцами нечего.
    const trigger = await screen.findByRole('button', { name: 'More actions' })
    await waitFor(() => expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument())
    await user.click(trigger)
    const item = await screen.findByRole('menuitem', { name: 'Publish this list' })
    expect(item.querySelector('span[aria-hidden]')).toBeInTheDocument()
  })

  it('применённое действие гасит свою точку и не трогает чужую', async () => {
    const user = userEvent.setup()
    render(<ListActionsMenu {...props} canTranslate targetLang="ru" />)
    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Publish this list' }))

    expect(window.localStorage.getItem('sf:hint:publish:draft-1')).toBe('1')
    expect(window.localStorage.getItem('sf:hint:translate:draft-1')).toBeNull()

    // Пункт публикации не закрывает меню сам (ждёт старта перехода) — закрываем,
    // иначе Radix прячет кнопку от доступного дерева и её не найти по роли.
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    expect(
      (await screen.findByRole('menuitem', { name: 'Publish this list' })).querySelector('span[aria-hidden]'),
    ).toBeNull()
    expect(
      screen.getByRole('menuitem', { name: /Русский/ }).querySelector('span[aria-hidden]'),
    ).toBeInTheDocument()
  })

  it('без доступных действий меню не появляется вовсе — точке негде жить', async () => {
    render(<ListActionsMenu {...props} canPublish={false} />)
    const only = await screen.findByRole('link', { name: 'Edit' })
    expect(only).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument())
  })
})
