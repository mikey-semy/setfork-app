import { render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import { SidebarProvider, useSidebar } from '@/widgets/sidebar-context'

/**
 * САЙДБАР ОТКРЫВАЕТСЯ СВЁРНУТЫМ.
 *
 * Раньше он разворачивался сам, и на дашборде выходило два списка рядом: панель «Топ
 * списков» в сайдбаре и модуль «Списки» в основной области — одно и то же, дважды и
 * одновременно. Найдено владельцем на живом сайте.
 *
 * Проверяется ровно граница между «умолчанием» и «выбором человека»: выбор сильнее
 * умолчания, его отсутствие — нет. Иначе правка умолчания однажды затрёт чужой выбор,
 * и заметят это не сразу.
 *
 * Выбор живёт КУКОЙ и приходит с сервера пропом: страница сразу рисуется такой, какой
 * человек её оставил. Раньше он лежал только в localStorage, сервер о нём не знал, и
 * развернувший видел прыжок после гидрации (замечание авто-ревью по #811). Старая запись
 * в localStorage поэтому не выбрасывается, а ОДИН РАЗ переносится в куку.
 */

function Probe() {
  const { collapsed } = useSidebar()
  // Состояние отдаём атрибутом, а не подписью: правило проекта запрещает двуязычные
  // тернарники в коде, и обходить его точечным disable ради теста незачем.
  return <span data-testid="state" data-collapsed={String(collapsed)} />
}

const show = (initialCollapsed?: boolean) =>
  render(
    <SidebarProvider initialCollapsed={initialCollapsed}>
      <Probe />
    </SidebarProvider>,
  )

const state = () => screen.getByTestId('state').getAttribute('data-collapsed')

beforeEach(() => {
  localStorage.clear()
  // Куки в jsdom общие на документ — чистим, иначе соседний тест решит, что перенос уже был.
  for (const c of document.cookie.split(';')) document.cookie = `${c.split('=')[0].trim()}=; max-age=0; path=/`
})

describe('состояние сайдбара при заходе', () => {
  it('без выбора — свёрнут', () => {
    show()
    expect(state()).toBe('true')
  })

  it('выбор с сервера сильнее умолчания', () => {
    // Сервер прочитал куку и прислал «развёрнут» — рисуем сразу таким, без эффекта.
    show(false)
    expect(state()).toBe('false')
  })

  it('старый выбор из localStorage переносится в куку один раз', () => {
    localStorage.setItem('sf.sidebar.collapsed', '0')
    show()
    expect(state()).toBe('false')
    expect(document.cookie).toContain('sf_sidebar=0')
  })

  it('кука есть — localStorage больше не смотрим', () => {
    document.cookie = 'sf_sidebar=1; path=/'
    localStorage.setItem('sf.sidebar.collapsed', '0')
    show(true)
    expect(state()).toBe('true')
  })
})
