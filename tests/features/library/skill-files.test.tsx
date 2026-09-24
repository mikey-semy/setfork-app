import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillFiles } from '@/features/library/SkillFiles'

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
    render(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    expect(screen.getByText('scripts')).toBeTruthy()
    expect(screen.getByText('review.py')).toBeTruthy()
    expect(screen.getByText('47 KB')).toBeTruthy()
    expect(screen.getByText('755')).toBeTruthy()
    expect(screen.getByText('900 B')).toBeTruthy()
  })

  it('папка сворачивается', () => {
    render(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('references'))
    expect(screen.queryByText('hunter.md')).toBeNull()
  })

  it('файл открывается по щелчку — той версии, что показана', async () => {
    const fetch = vi.fn(async () => new Response('print("hi")'))
    vi.stubGlobal('fetch', fetch)
    render(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('review.py'))
    await waitFor(() => expect(screen.getByText('print("hi")')).toBeTruthy())
    expect(fetch).toHaveBeenCalledWith('/miki/kit/blob?path=scripts%2Freview.py&v=4')
  })

  it('сбой загрузки — причина и «Повторить», а не пустое окно', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })))
    render(<SkillFiles files={FILES} base="/miki/kit" version={4} lang="en" />)
    fireEvent.click(screen.getByText('hunter.md'))
    await waitFor(() => expect(screen.getByText('Could not open the file.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('без файлов блока нет', () => {
    const { container } = render(<SkillFiles files={[]} base="/miki/kit" version={4} lang="en" />)
    expect(container.innerHTML).toBe('')
  })
})
