import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CloneDropdown } from '@/features/git/CloneDropdown'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { CopyButton } from '@/shared/ui/CopyButton'
import { AUTHORED_DIALECT, dialectSpec, scriptFilename } from '@/core/domain/script-dialect'

/**
 * Меню «Получить» — ЕДИНСТВЕННЫЙ вход в машинные поверхности (/raw, data.json, MCP,
 * embed) во всём продукте. До этих тестов его не проверял ни один гейт: компонентных
 * тестов не было, скриншот-эталоны сняты только с витрины UI Kit, а Lighthouse и axe
 * закрытые поповеры не открывают. Полный прогон линзы 07 со 136 браузерными визитами
 * прошёл мимо всех находок именно поэтому.
 *
 * Фиксируем то, что было сломано незаметно:
 *  - содержимое было внутри Radix-меню, которое перехватывает Tab и водит фокус только
 *    по своим пунктам → ни поля, ни вкладки, ни кнопки не достигались с клавиатуры;
 *  - вкладки не были объявлены вкладками (ни ролей, ни aria-selected, ни стрелок);
 *  - команда жила в однострочном input: видно было меньше трети, `| bash` — за краем;
 *  - отказ буфера обмена не имел состояния — кнопка молчала.
 */
const open = () => {
  render(
    <TooltipProvider>
      <CloneDropdown base="/alice/deploy" slug="deploy" lang="en" />
    </TooltipProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /get|получить/i }))
}

describe('меню «Получить»: доступность и содержимое', () => {
  it('содержимое НЕ внутри роли menu — иначе Tab перехватывается и всё недостижимо', () => {
    open()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(screen.getByRole('tablist')).toBeTruthy()
  })

  it('вкладки объявлены вкладками и переключаются стрелками', () => {
    open()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })

  it('команда запуска показана целиком и с переносом, а не в однострочном поле', () => {
    open()
    fireEvent.click(screen.getByRole('tab', { name: /run/i }))

    // Полная команда присутствует в разметке — включая опасный хвост `| bash`.
    // Сверяемся с КАТАЛОГОМ ДИАЛЕКТОВ, а не с переписанной сюда строкой: команду
    // печатают и меню, и шапка самого скрипта, и разъезжаться им нельзя.
    // Ищем по textContent целиком: подсветка раскладывает строку на токены-спаны
    // (адрес в кавычках — отдельный токен), и getByText её уже не видит одним узлом.
    const expected = dialectSpec(AUTHORED_DIALECT).run(
      `${window.location.origin}/alice/deploy/raw`,
      scriptFilename('deploy', AUTHORED_DIALECT),
    )
    expect(document.body.textContent).toContain(expected)
    // Команда СКАЧИВАЕТ и только потом запускает: конвейер `curl -f … | bash` при
    // отказе сервера возвращает ноль и выглядит как успешный прогон.
    expect(expected).not.toMatch(/\|\s*bash/)
    // И она не лежит в input, который обрезает значение по ширине поля.
    const inputs = Array.from(document.querySelectorAll('input')).map((i) => i.getAttribute('value') ?? '')
    expect(inputs.some((v) => v.includes('| bash'))).toBe(false)
  })

  it('PowerShell-формы запуска нет: обёртка диалекта не переводит авторские команды', () => {
    open()
    fireEvent.click(screen.getByRole('tab', { name: /run/i }))

    // `/raw?lang=ps1` на списке с командами теперь отвечает 406, поэтому предлагать
    // эту форму — значит класть человеку в буфер заведомо нерабочую команду.
    expect(document.body.textContent).not.toMatch(/lang=ps1|\| iex/)
  })

  it('во вкладке клонирования сказано, как быть с приватным списком', () => {
    open()
    // Строка есть в словарях обоих языков и раньше не выводилась нигде.
    expect(screen.getByText(/API token/i)).toBeTruthy()
  })
})

describe('копирование: отказ буфера виден пользователю', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('без доступа к буферу кнопка сообщает об ошибке, а не молчит', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    render(
      <TooltipProvider>
        <CopyButton text="x" label="Copy" failedLabel="Copy failed" />
      </TooltipProvider>,
    )
    const btn = screen.getByRole('button', { name: 'Copy' })
    fireEvent.click(btn)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy failed' })).toBeTruthy())
    vi.useRealTimers()
  })
})
