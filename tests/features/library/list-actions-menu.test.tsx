import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/library/actions/versions', () => ({ publishList: vi.fn(async () => {}) }))
vi.mock('@/features/library/actions/ai', () => ({ translateList: vi.fn(async () => ({})) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/shared/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))

const { translateList } = await import('@/features/library/actions/ai')
const { toast } = await import('sonner')
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
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  /**
   * ⚠️ Состояние подсказок читается в requestAnimationFrame, поэтому «точки нет»
   * выполняется само собой на первом же кадре — до того, как компонент вообще успел
   * что-то решить. Прежде чем утверждать отсутствие, ждём, что кадр отработал: у
   * кнопки появилась её обычная подпись.
   */
  const afterHintsRead = async (name: RegExp | string) => {
    await screen.findByRole('button', { name })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
  }

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
    expect(window.localStorage.getItem('sf:hint-seen:publish:draft-1')).toBe('1')
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
    await afterHintsRead('More actions')
    expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'More actions' })
    await user.click(trigger)
    const item = await screen.findByRole('menuitem', { name: 'Publish this list' })
    expect(item.querySelector('span[aria-hidden]')).toBeInTheDocument()
  })

  it('перевод гасит свою подсказку только при успехе', async () => {
    const user = userEvent.setup()
    render(<ListActionsMenu {...props} canTranslate targetLang="ru" />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /Русский/ }))
    await waitFor(() => expect(window.localStorage.getItem('sf:hint:translate:draft-1')).toBe('1'))
    // Публикация чужую подсказку не трогает и своей не пишет вовсе.
    expect(window.localStorage.getItem('sf:hint:publish:draft-1')).toBeNull()
  })

  it('провалившийся перевод подсказку НЕ тратит — действие не применилось', async () => {
    vi.mocked(translateList).mockResolvedValueOnce({ error: 'ai_unavailable' })
    const user = userEvent.setup()
    render(<ListActionsMenu {...props} canTranslate targetLang="ru" />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /Русский/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(window.localStorage.getItem('sf:hint:translate:draft-1')).toBeNull()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: /Русский/ }).querySelector('span[aria-hidden]')).toBeInTheDocument()
  })

  it('подсказка публикации не тратится по клику: удавшаяся публикация уносит сам пункт', async () => {
    const user = userEvent.setup()
    const view = render(<ListActionsMenu {...props} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Publish this list' }))

    // Ключа нет: publishList ничего не возвращает, и «применено» по клику не узнать.
    // Провалившаяся публикация обязана оставить пункт помеченным.
    expect(window.localStorage.getItem('sf:hint:publish:draft-1')).toBeNull()

    // А удавшаяся приходит перерисовкой: черновик больше не черновик.
    await user.keyboard('{Escape}')
    view.rerender(<ListActionsMenu {...props} canPublish={false} />)
    expect(screen.queryByRole('menuitem', { name: 'Publish this list' })).toBeNull()
  })

  it('память о показе — на КАЖДУЮ подсказку: новая зажигает точку снова', async () => {
    const user = userEvent.setup()
    // Заглянули ради перевода; публикация тогда была недоступна.
    const first = render(<ListActionsMenu {...props} canPublish={false} canTranslate targetLang="ru" />)
    await user.click(await screen.findByRole('button', { name: 'This list can be translated' }))
    await user.keyboard('{Escape}')
    expect(window.localStorage.getItem('sf:hint-seen:translate:draft-1')).toBe('1')
    first.unmount()

    // Позже список стал черновиком — про публикацию человек ещё не знает.
    render(<ListActionsMenu {...props} canTranslate targetLang="ru" />)
    await screen.findByRole('button', { name: 'You can publish this list' })
    await waitFor(() => expect(document.querySelector('[data-publish-hint]')).toBeInTheDocument())
  })

  it('старая память переносится: разобранный черновик не мигает заново', async () => {
    // До 01.09.2026 ключ был один на список.
    window.localStorage.setItem('sf:publish-hint:draft-1', '1')
    render(<ListActionsMenu {...props} />)
    await afterHintsRead('More actions')
    expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('sf:hint-seen:publish:draft-1')).toBe('1')
    expect(window.localStorage.getItem('sf:publish-hint:draft-1')).toBeNull()
  })

  it('без доступных действий меню не появляется вовсе — точке негде жить', async () => {
    render(<ListActionsMenu {...props} canPublish={false} />)
    const only = await screen.findByRole('link', { name: 'Edit' })
    expect(only).toBeInTheDocument()
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument()
  })
})
