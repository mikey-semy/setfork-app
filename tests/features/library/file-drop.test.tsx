import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileDrop } from '@/features/library/FileDrop'
import { ATTACH_MAX_BYTES, megabytes, VIDEO_MAX_BYTES } from '@/shared/media/limits'

/**
 * ОДНА ДРОПЗОНА НА ТРИ ВИДА ЗАГРУЗКИ.
 *
 * Скриншот, видеофайл и вложение грузились тремя почти дословными копиями одного
 * компонента: различались MIME-фильтром, иконкой и подписью. Копии разъезжаются —
 * например, «до 50 МБ» в подписи и лимит, по которому сервер реально отказывает,
 * жили отдельными числами в разных файлах.
 *
 * Тест держит два правила: вид задаёт accept, а размер в подписи берётся из той же
 * константы, по которой режет сервер.
 */
const inputOf = (): HTMLInputElement => document.querySelector('input[type="file"]')!

describe('FileDrop', () => {
  it('вид задаёт MIME-фильтр: картинка и видео фильтруют, вложение принимает любой тип', () => {
    const { rerender } = render(<FileDrop kind="image" uploading={false} onFile={() => {}} lang="ru" />)
    expect(inputOf().accept).toContain('image/png')

    rerender(<FileDrop kind="video" uploading={false} onFile={() => {}} lang="ru" />)
    expect(inputOf().accept).toContain('video/mp4')

    // Вложению фильтр не ставим: расширение проверяет сервер по своему белому списку.
    rerender(<FileDrop kind="file" uploading={false} onFile={() => {}} lang="ru" />)
    expect(inputOf().accept).toBe('')
  })

  it('размер в подписи — из константы сервера, а не своим числом', () => {
    const { rerender } = render(<FileDrop kind="video" uploading={false} onFile={() => {}} lang="ru" />)
    expect(screen.getByRole('button')).toHaveTextContent(`${megabytes(VIDEO_MAX_BYTES)} МБ`)

    rerender(<FileDrop kind="file" uploading={false} onFile={() => {}} lang="en" />)
    expect(screen.getByRole('button')).toHaveTextContent(`${megabytes(ATTACH_MAX_BYTES)} MB`)
  })

  it('выбранный файл уходит наверх, а поле очищается — тот же файл можно выбрать снова', async () => {
    const onFile = vi.fn()
    render(<FileDrop kind="image" uploading={false} onFile={onFile} lang="ru" />)
    const file = new File(['x'], 'shot.png', { type: 'image/png' })

    await userEvent.upload(inputOf(), file)

    expect(onFile).toHaveBeenCalledWith(file)
    expect(inputOf().value).toBe('')
  })

  it('во время загрузки подпись меняется на «Загрузка…»', () => {
    render(<FileDrop kind="image" uploading onFile={() => {}} lang="ru" />)
    expect(screen.getByRole('button')).toHaveTextContent('Загрузка…')
  })
})
