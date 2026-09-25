import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
})
