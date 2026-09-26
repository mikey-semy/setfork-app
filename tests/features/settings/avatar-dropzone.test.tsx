import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * АВАТАР С ТЕЛЕФОНА: предел держит КАДР, а не исходное фото.
 *
 * Было: 2 МБ проверялись на исходнике до кадрирования — обычное фото с iPhone
 * (3–10 МБ) нельзя было поставить аватаром вовсе, хотя в форму уходит только кадр
 * 512px. Та же ошибка, что была у обложки.
 *
 * Кадрирование подменено: это соседний компонент со своими тестами
 * (avatar-cropper-type), здесь проверяется только решение дропзоны о его результате.
 */
const crop = vi.hoisted(() => ({ result: null as File | null }))
vi.mock('@/shared/ui/AvatarCropper', () => ({
  AvatarCropper: ({ open, onDone }: { open: boolean; onDone: (f: File) => void }) =>
    open ? <button type="button" onClick={() => onDone(crop.result!)}>готово</button> : null,
}))
URL.createObjectURL = vi.fn(() => 'blob:x')
URL.revokeObjectURL = vi.fn()
// DataTransfer — браузерный API, в jsdom его нет: дропзона кладёт им кадр в поле формы.
class FakeDataTransfer {
  private list: File[] = []
  items = { add: (f: File) => void this.list.push(f) }
  get files() {
    return this.list as unknown as FileList
  }
}
vi.stubGlobal('DataTransfer', FakeDataTransfer)

const { AvatarDropzone } = await import('@/features/settings/AvatarDropzone')

const bytes = (n: number, type: string, name: string) => new File([new Uint8Array(n)], name, { type })

function pick(file: File) {
  render(<AvatarDropzone handle="mike" avatarUrl={null} lang="ru" />)
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

describe('AvatarDropzone', () => {
  it('фото с телефона больше 2 МБ открывает кадрирование, а не отказ', () => {
    crop.result = bytes(80_000, 'image/png', 'avatar.png')
    pick(bytes(6_000_000, 'image/jpeg', 'IMG_0001.jpg'))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'готово' }))
    expect(screen.queryByRole('alert')).toBeNull()
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    expect(input.files?.[0]).toBe(crop.result) // в форму ушёл кадр, а не исходник
  })

  it('кадр больше предела — причина, в форму не уходит', () => {
    crop.result = bytes(3_000_000, 'image/png', 'avatar.png')
    const input = pick(bytes(6_000_000, 'image/jpeg', 'IMG_0001.jpg'))
    fireEvent.click(screen.getByRole('button', { name: 'готово' }))
    expect(screen.getByRole('alert').textContent).toContain('2')
    expect(input.files?.[0]).not.toBe(crop.result) // слишком большой кадр в форму не лёг
  })

  it('не картинка — отказ сразу', () => {
    pick(bytes(1000, 'application/pdf', 'doc.pdf'))
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
