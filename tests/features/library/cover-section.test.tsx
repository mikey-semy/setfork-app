import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MAX_BYTES, megabytes } from '@/shared/media/limits'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { fakeImageApi } from '../../helpers/fake-image-api'

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
 * Подменяется только внешнее — серверный экшен и (где нужно) браузерный декодер с
 * холстом. Уменьшение, проверка размера и формата, карта причин и сам компонент —
 * настоящие. Без подмены декодера в jsdom его нет — файл уходит как есть.
 */
const setListCover = vi.fn()
const setListAccent = vi.fn(async (_id: string, _a: string) => {})
const removeListCover = vi.fn(async (_id: string) => {})
vi.mock('@/features/library/cover-actions', () => ({
  setListCover: (fd: FormData) => setListCover(fd),
  removeListCover: (id: string) => removeListCover(id),
  setListAccent: (id: string, a: string) => setListAccent(id, a),
}))

const { CoverSection } = await import('@/features/library/CoverSection')

const inputOf = (): HTMLInputElement => document.querySelector('input[type="file"]')!
const photo = (bytes = 1024, type = 'image/jpeg') => new File([new Uint8Array(bytes)], 'IMG_0001.jpg', { type })

function renderSection(lang: 'ru' | 'en' = 'ru', initialCover: string | null = null) {
  return render(
    <TooltipProvider>
      <CoverSection templateId="t1" slug="soup" initialCover={initialCover} initialAccent={null} lang={lang} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  setListCover.mockReset()
  setListAccent.mockReset()
  removeListCover.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    renderSection('ru', 'https://img.example/old.webp')
    const zone = screen.getByRole('button', { name: 'Обложка' })

    await userEvent.upload(inputOf(), photo())

    // Имя кнопки не перекрывает ожидание: читалка экрана слышит «Загрузка…».
    expect(zone).toHaveAccessibleName('Загрузка…')
    expect(zone).toHaveAttribute('aria-busy', 'true')
    expect(zone).toBeDisabled()
    // Текст не прячется за hover-слоем: сам слой ожидания виден всегда.
    const status = screen.getByText('Загрузка…')
    expect(status.closest('.opacity-0')).toBeNull()

    // Убрать обложку посреди загрузки нельзя: ответ загрузки тут же вернул бы её.
    expect(screen.getByRole('button', { name: /Убрать обложку/ })).toBeDisabled()

    finish({ ok: true, url: 'https://img.example/c.webp' })
    await waitFor(() => expect(zone).toHaveAttribute('aria-busy', 'false'))
    expect(zone).toHaveAccessibleName('Обложка')
  })

  it('уменьшение сорвалось исключением → уходит оригинал, «Загрузка…» не висит вечно', async () => {
    fakeImageApi({ width: 4032, height: 3024, outBytes: 300_000, closeThrows: true })
    setListCover.mockResolvedValueOnce({ ok: true, url: 'https://img.example/c.webp' })
    renderSection()
    const file = photo()

    await userEvent.upload(inputOf(), file)

    await waitFor(() => expect(setListCover).toHaveBeenCalledTimes(1))
    expect((setListCover.mock.calls[0][0] as FormData).get('file')).toBe(file)
    await waitFor(() => expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument())
  })

  it('фото 6 МБ уменьшается ДО проверки предела и уходит на сервер, а не отказом «больше 4 МБ»', async () => {
    fakeImageApi({ width: 4032, height: 3024, outBytes: 300_000 })
    setListCover.mockResolvedValueOnce({ ok: true, url: 'https://img.example/c.webp' })
    renderSection()

    await userEvent.upload(inputOf(), photo(6 * 1024 * 1024))

    await waitFor(() => expect(setListCover).toHaveBeenCalledTimes(1))
    const sent = (setListCover.mock.calls[0][0] as FormData).get('file') as File
    expect(sent.size).toBe(300_000)
    expect(sent.type).toBe('image/jpeg')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

describe('CoverSection — акцент и удаление не врут при сбое', () => {
  it('сервер не сохранил акцент → выбор откатывается, причина и «Повторить»', async () => {
    setListAccent.mockRejectedValueOnce(new TypeError('Load failed'))
    setListAccent.mockResolvedValueOnce(undefined)
    renderSection()
    const blue = screen.getByRole('button', { name: '#2159d6' })

    await userEvent.click(blue)

    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение не сохранилось')
    // Откат: выбранным снова стоит прежний (по умолчанию), а не тот, что не сохранился.
    expect(blue.getAttribute('aria-pressed')).not.toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(setListAccent).toHaveBeenCalledTimes(2))
    expect(setListAccent.mock.calls[1]).toEqual(['t1', '#2159d6'])
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('A упал уже ПОСЛЕ того, как выбран и сохранён B → экран остаётся на B, ошибки нет', async () => {
    let failA: (e: unknown) => void = () => {}
    setListAccent.mockImplementationOnce(() => new Promise((_, reject) => (failA = reject)))
    setListAccent.mockResolvedValueOnce(undefined)
    renderSection()
    const a = screen.getByRole('button', { name: '#2159d6' })
    const b = screen.getByRole('button', { name: '#7c3aed' })

    await userEvent.click(a)
    await userEvent.click(b)
    await waitFor(() => expect(setListAccent).toHaveBeenCalledTimes(2))
    failA(new TypeError('Load failed'))

    await waitFor(() => expect(b).toHaveAttribute('aria-pressed', 'true'))
    await new Promise((r) => setTimeout(r, 0))
    expect(b).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ошибочная полоса одна: новое действие гасит причину прежнего', async () => {
    setListCover.mockRejectedValueOnce(new TypeError('Load failed'))
    setListAccent.mockRejectedValueOnce(new TypeError('Load failed'))
    renderSection()

    await userEvent.upload(inputOf(), photo())
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером')

    await userEvent.click(screen.getByRole('button', { name: '#2159d6' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Изменение не сохранилось'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('удаление не сохранилось → обложка возвращается, причина и «Повторить»', async () => {
    removeListCover.mockRejectedValueOnce(new TypeError('Load failed'))
    renderSection('ru', 'https://img.example/old.webp')

    await userEvent.click(screen.getByRole('button', { name: /Убрать обложку/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение не сохранилось')
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://img.example/old.webp')
  })
})
