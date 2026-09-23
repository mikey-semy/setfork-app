import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MAX_BYTES, megabytes } from '@/shared/media/limits'
import { TooltipProvider } from '@/shared/ui/Tooltip'

/**
 * ОБЛОЖКА СПИСКА: ВЫБОР КАРТИНКИ НЕ МОЛЧИТ.
 *
 * Жалоба с прода (iOS Safari): выбираешь фото — ничего. Причин было три, все тихие:
 *  • экшен ОТКЛОНЯЛСЯ (тело больше 1 МБ — предел Next по умолчанию, фото с iPhone
 *    больше), а у промиса не было catch — ошибка уходила в unhandled rejection;
 *  • кружок загрузки жил в слое `opacity-0 hover:opacity-100` — на пальце hover нет,
 *    и ожидание не было видно никогда;
 *  • ответ с ошибкой превращался в общее «Не удалось загрузить» без причины.
 *
 * Подменяется только внешнее — серверный экшен. Проверка размера и формата, карта
 * причин и сам компонент — настоящие.
 */
const setListCover = vi.fn()
vi.mock('@/features/library/cover-actions', () => ({
  setListCover: (fd: FormData) => setListCover(fd),
  removeListCover: vi.fn(async () => {}),
  setListAccent: vi.fn(async () => {}),
}))

const { CoverSection } = await import('@/features/library/CoverSection')

const inputOf = (): HTMLInputElement => document.querySelector('input[type="file"]')!
const photo = (bytes = 1024, type = 'image/jpeg') => new File([new Uint8Array(bytes)], 'IMG_0001.jpg', { type })

function renderSection(lang: 'ru' | 'en' = 'ru') {
  return render(
    <TooltipProvider>
      <CoverSection templateId="t1" slug="soup" initialCover={null} initialAccent={null} lang={lang} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  setListCover.mockReset()
})

describe('CoverSection — загрузка обложки', () => {
  it('сервер отказал (экшен отклонён) → причина на экране и «Повторить» шлёт тот же файл', async () => {
    setListCover.mockRejectedValueOnce(new Error('An error occurred in the Server Components render.'))
    setListCover.mockResolvedValueOnce({ ok: true, url: 'https://img.example/c.webp' })
    renderSection()
    const file = photo()

    await userEvent.upload(inputOf(), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер не сохранил обложку')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => expect(setListCover).toHaveBeenCalledTimes(2))
    expect((setListCover.mock.calls[1][0] as FormData).get('file')).toBe(file)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://img.example/c.webp')
  })

  it('обрыв сети (TypeError от fetch) называется сетью, а не сервером', async () => {
    setListCover.mockRejectedValueOnce(new TypeError('Load failed'))
    renderSection()

    await userEvent.upload(inputOf(), photo())

    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером')
  })

  it('отказ сервера кодом → своя причина, а не общее «не удалось»', async () => {
    setListCover.mockResolvedValueOnce({ error: 'bad_type' })
    renderSection('en')

    await userEvent.upload(inputOf(), photo())

    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPG, WEBP or GIF')
  })

  it('пока файл летит — «Загрузка…» видна без наведения, кнопка занята', async () => {
    let finish: (v: unknown) => void = () => {}
    setListCover.mockReturnValueOnce(new Promise((r) => (finish = r)))
    renderSection()

    await userEvent.upload(inputOf(), photo())

    const zone = screen.getByRole('button', { name: /Обложка/ })
    expect(zone).toHaveAttribute('aria-busy', 'true')
    expect(zone).toBeDisabled()
    // Текст не прячется за hover-слоем: сам слой ожидания виден всегда.
    const status = screen.getByText('Загрузка…')
    expect(status.closest('.opacity-0')).toBeNull()

    finish({ ok: true, url: 'https://img.example/c.webp' })
    await waitFor(() => expect(zone).toHaveAttribute('aria-busy', 'false'))
  })

  it('файл больше предела → причина с размером сразу, на сервер не уходит', async () => {
    renderSection()

    await userEvent.upload(inputOf(), photo(IMAGE_MAX_BYTES + 1))

    expect(await screen.findByRole('alert')).toHaveTextContent(`${megabytes(IMAGE_MAX_BYTES)} МБ`)
    expect(setListCover).not.toHaveBeenCalled()
    // Тот же файл не станет меньше — вместо «Повторить» предлагаем выбрать другой.
    expect(screen.getByRole('button', { name: 'Выбрать другую' })).toBeInTheDocument()
  })

  it('HEIC с iPhone → причина «формат», на сервер не уходит', async () => {
    renderSection()

    // accept у поля такой файл не пропустит — снимаем фильтр, как его обходят
    // перетаскивание и Safari, отдавший HEIC без перекодирования.
    await userEvent.setup({ applyAccept: false }).upload(inputOf(), photo(1024, 'image/heic'))

    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPG, WEBP или GIF')
    expect(setListCover).not.toHaveBeenCalled()
  })

  it('успех → новая обложка на месте баннера, поле очищено для повторного выбора', async () => {
    setListCover.mockResolvedValueOnce({ ok: true, url: 'https://img.example/c.webp' })
    renderSection()

    await userEvent.upload(inputOf(), photo())

    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('https://img.example/c.webp'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(inputOf().value).toBe('')
  })
})
