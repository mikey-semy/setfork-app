import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillFiles } from '@/features/library/SkillFiles'
import { TooltipProvider } from '@/shared/ui/Tooltip'

// Просмотр — тот же блок кода, что в списках; его подсказки живут в TooltipProvider из корня приложения.
const view = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>)

/**
 * ПРОВОДНИК ФАЙЛОВ СКИЛЛА: папки, размеры, текст по щелчку — и видимый сбой.
 *
 * Подменён только `fetch` (сеть). Проверяется то, что ломается незаметно: файл открыт не
 * той версии (адрес без `v`), папка не сворачивается, сбой загрузки — пустое окно вместо
 * причины и «Повторить».
 */
const FILES = [
  { path: 'scripts/review.py', executable: true, bytes: 48_200 },
  { path: 'references/hunter.md', executable: false, bytes: 900 },
]

afterEach(() => vi.unstubAllGlobals())

describe('SkillFiles', () => {
  it('папки и файлы с размером; исполняемый помечен', () => {
    view(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    expect(screen.getByText('scripts')).toBeTruthy()
    expect(screen.getByText('review.py')).toBeTruthy()
    expect(screen.getByText('47 KB')).toBeTruthy()
    expect(screen.getByText('755')).toBeTruthy()
    expect(screen.getByText('900 B')).toBeTruthy()
  })

  it('папка сворачивается', () => {
    view(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('references'))
    expect(screen.queryByText('hunter.md')).toBeNull()
  })

  // Ответ /blob?format=lines: строки уже подсвечены на сервере.
  const linesResponse = (code: string) =>
    new Response(JSON.stringify({ code, language: 'python', lines: code.split('\n').map((l) => [{ text: l, cls: '' }]) }), {
      headers: { 'Content-Type': 'application/json' },
    })

  it('файл открывается по щелчку — той версии, что показана, подсвеченными строками', async () => {
    const fetch = vi.fn(async () => linesResponse('print("hi")'))
    vi.stubGlobal('fetch', fetch)
    view(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('review.py'))
    await waitFor(() => expect(screen.getByText('print("hi")')).toBeTruthy())
    expect(fetch).toHaveBeenCalledWith('/miki/kit/blob?path=scripts%2Freview.py&v=4&format=lines')
  })

  it('⚠️ файл раскрывается ПОД СВОЕЙ СТРОКОЙ, а не внизу блока', async () => {
    // Замечание владельца 25.09: у скилла на 26 файлов текст открывался экраном ниже,
    // и было не понять, открылся ли файл вообще.
    vi.stubGlobal('fetch', vi.fn(async () => linesResponse('a = 1\nb = 2')))
    view(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('review.py'))
    const code = await screen.findByText('a = 1')
    const row = screen.getByText('review.py').closest('li')!
    expect(row.contains(code)).toBe(true)
    // Номера строк — тот же блок кода, что в списках (CodeSurface).
    expect(row.textContent).toContain('1')
    expect(row.textContent).toContain('2')
    expect(screen.getByText('review.py').closest('button')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('повторный щелчок сворачивает; другой файл закрывает первый', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => linesResponse(url.includes('review') ? 'first()' : 'second()')))
    view(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('review.py'))
    await screen.findByText('first()')
    fireEvent.click(screen.getByText('hunter.md'))
    await screen.findByText('second()')
    expect(screen.queryByText('first()')).toBeNull()
    fireEvent.click(screen.getByText('hunter.md'))
    expect(screen.queryByText('second()')).toBeNull()
  })

  it('сбой загрузки — причина и «Повторить», а не пустое окно', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })))
    view(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('hunter.md'))
    await waitFor(() => expect(screen.getByText('Could not open the file.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('без файлов блока нет', () => {
    const { container } = render(<SkillFiles files={[]} base="/miki/kit" version={4} lang="en" />)
    expect(container.innerHTML).toBe('')
  })
})
