import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarCropper } from '@/shared/ui/AvatarCropper'
import { fakeImageApi } from '../../helpers/fake-image-api'

/**
 * АВАТАР НЕ ВРЁТ О СВОЁМ ФОРМАТЕ.
 *
 * Кадрирование просит у холста WebP. Safari WebP не кодирует и по спеке отдаёт PNG —
 * а файл назывался `avatar.webp` с типом image/webp: в хранилище ложился PNG под
 * чужим расширением и типом.
 *
 * Подменены только браузерные API (декодер <img>, холст) — сам компонент настоящий.
 */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const labels = { title: 'Кадр', zoom: 'Масштаб', apply: 'Готово', cancel: 'Отмена', failed: 'Не вышло' }

async function crop(): Promise<File> {
  const onDone = vi.fn()
  render(<AvatarCropper open src="blob:fake/src" onCancel={() => {}} onDone={onDone} labels={labels} />)
  const apply = screen.getByRole('button', { name: 'Готово' })
  // Кнопка работает, лишь когда картинка загрузилась (событие load после src).
  await waitFor(async () => {
    await userEvent.click(apply)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
  return onDone.mock.calls[0][0] as File
}

describe('AvatarCropper', () => {
  it('Safari: просили WebP, кодировщик отдал PNG → файл avatar.png с типом image/png', async () => {
    const seen = fakeImageApi({ width: 800, height: 600, cannotEncode: ['image/webp'] })
    const file = await crop()
    expect(seen.encodedAs).toEqual(['image/webp'])
    expect(file.type).toBe('image/png')
    expect(file.name).toBe('avatar.png')
  })

  it('браузер с WebP → avatar.webp', async () => {
    fakeImageApi({ width: 800, height: 600 })
    const file = await crop()
    expect(file.type).toBe('image/webp')
    expect(file.name).toBe('avatar.webp')
  })
})
