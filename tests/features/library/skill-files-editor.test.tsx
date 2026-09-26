import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillFilesEditor } from '@/features/library/list-editor/SkillFilesEditor'

/**
 * РАЗДЕЛ ФАЙЛОВ В РЕДАКТОРЕ: что форма шлёт в `authored`.
 *
 * Ломается молча именно это: поле без касаний значит «стереть и записать то же», а
 * отсутствие поля после удаления последнего файла — «оставить как было». Оба дефекта
 * на экране не видны, их видит только следующая версия.
 */
const RUN = { path: 'scripts/run.sh', text: 'echo hi\n', executable: true }
const field = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[name="authored"]')

describe('SkillFilesEditor', () => {
  it('не трогали — поля нет: файлы перенесёт ядро', () => {
    const { container } = render(<SkillFilesEditor initial={[RUN]} dirty={false} lang="en" />)
    expect(screen.getByText('scripts/run.sh')).toBeTruthy()
    expect(field(container)).toBeNull()
  })

  it('убрали последний файл — поле есть и пустое: набор стирается', () => {
    const { container } = render(<SkillFilesEditor initial={[RUN]} dirty={false} lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove file: scripts/run.sh' }))
    expect(field(container)?.value).toBe('[]')
  })

  it('добавленный скрипт — исполняемый по умолчанию; имя с подпапкой не добавляется', () => {
    const { container } = render(<SkillFilesEditor initial={[]} dirty={false} lang="en" />)
    const name = screen.getByLabelText('File name')
    fireEvent.change(name, { target: { value: 'sub/x.sh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }))
    expect(screen.getByText(/No "\/" or "\.\."/)).toBeTruthy()
    expect(field(container)).toBeNull()
    fireEvent.change(name, { target: { value: 'build.sh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }))
    expect(JSON.parse(field(container)!.value)).toEqual([{ path: 'scripts/build.sh', text: '', executable: true }])
  })

  it('черновик уже держит правку файлов — поле шлётся и без новых касаний', () => {
    const { container } = render(<SkillFilesEditor initial={[RUN]} dirty lang="en" />)
    expect(JSON.parse(field(container)!.value)).toEqual([RUN])
  })

  it('файлы не прочитались — правки нет, поле не шлётся, причина названа', () => {
    const { container } = render(<SkillFilesEditor initial={null} dirty={false} lang="en" />)
    expect(screen.getByText(/could not be read/)).toBeTruthy()
    expect(field(container)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('двоичный файл — размер, а не текст указателя; править нельзя', () => {
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 2048\n`
    render(<SkillFilesEditor initial={[{ path: 'assets/logo.png', text: pointer, executable: false }]} dirty={false} lang="en" />)
    expect(screen.getByText('2.0 KB')).toBeTruthy()
    fireEvent.click(screen.getByText('assets/logo.png'))
    expect(screen.getByText(/A binary file/)).toBeTruthy()
    expect(screen.queryByText(/oid sha256/)).toBeNull()
  })

  it('загрузка с диска: файл уходит в /api/skill-asset, ответ ложится в набор под своим путём', async () => {
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'b'.repeat(64)}\nsize 3\n`
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ path: 'scripts/logo.png', kind: 'binary', text: pointer, size: 3 })))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<SkillFilesEditor initial={[]} dirty={false} lang="en" />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 0, 2])], 'logo.png')] } })
    await waitFor(() => expect(field(container)).not.toBeNull())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: FormData }]
    expect(url).toBe('/api/skill-asset')
    // Папка по умолчанию — scripts/: путь уходит тем, что выбрано в форме.
    expect(init.body.get('path')).toBe('scripts/logo.png')
    expect(JSON.parse(field(container)!.value)).toEqual([{ path: 'scripts/logo.png', text: pointer, executable: false }])
  })

  it('отказ загрузки — причина видна, набор не тронут', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'too big' }), { status: 400 })))
    const { container } = render(<SkillFilesEditor initial={[]} dirty={false} lang="en" />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.bin')] } })
    await waitFor(() => expect(screen.getByText('The file was not uploaded: too big')).toBeTruthy())
    expect(field(container)).toBeNull()
  })
})
