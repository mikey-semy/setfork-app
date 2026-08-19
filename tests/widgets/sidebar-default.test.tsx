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
 * Проверяется ровно граница между «умолчанием» и «выбором человека»: запись в хранилище
 * сильнее умолчания, её отсутствие — нет. Иначе правка умолчания однажды затрёт чужой
 * выбор, и заметят это не сразу.
 */

function Probe() {
  const { collapsed } = useSidebar()
  // Состояние отдаём атрибутом, а не подписью: правило проекта запрещает двуязычные
  // тернарники в коде, и обходить его точечным disable ради теста незачем.
  return <span data-testid="state" data-collapsed={String(collapsed)} />
}

const show = () =>
  render(
    <SidebarProvider>
      <Probe />
    </SidebarProvider>,
  )

beforeEach(() => localStorage.clear())

describe('состояние сайдбара при заходе', () => {
  it('без выбора в хранилище — свёрнут', () => {
    show()
    expect(screen.getByTestId('state')).toHaveAttribute('data-collapsed', 'true')
  })

  it('человек развернул — так и остаётся', () => {
    localStorage.setItem('sf.sidebar.collapsed', '0')
    show()
    expect(screen.getByTestId('state')).toHaveAttribute('data-collapsed', 'false')
  })

  it('человек свернул — тоже остаётся', () => {
    localStorage.setItem('sf.sidebar.collapsed', '1')
    show()
    expect(screen.getByTestId('state')).toHaveAttribute('data-collapsed', 'true')
  })
})
