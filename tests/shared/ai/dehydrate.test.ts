import { describe, it, expect } from 'vitest'
import { dehydrateScaffold } from '@/shared/ai/dehydrate'

// Реальный ответ из чата раскопки (жалоба владельца): модель выдала бланк
// вместо человеческой речи.
const ROBOT = `Задача: объяснение этапа рецепта. Метод: анализ.

Понимание: нужно объяснить, почему желатин замачивают в холодной воде перед использованием.
План: описать, что произойдёт, если не замочить желатин.
Выполнение:
Желатин нужно замочить в холодной воде, чтобы он равномерно набух.
Если не сделать этого, желатин растворится комками.
Проверка: убедиться, что объяснение понятно и охватывает все ключевые аспекты.`

describe('dehydrateScaffold', () => {
  it('срезает ярлыки-леса, но СОДЕРЖИМОЕ сохраняет', () => {
    const out = dehydrateScaffold(ROBOT)
    expect(out).toContain('Желатин нужно замочить в холодной воде')
    expect(out).toContain('растворится комками')
    expect(out).not.toMatch(/^Задача:/m)
    expect(out).not.toMatch(/^Понимание:/m)
    expect(out).not.toMatch(/^План:/m)
    expect(out).not.toMatch(/^Выполнение:/m)
  })

  it('самооценку процесса выкидывает целиком', () => {
    const out = dehydrateScaffold(ROBOT)
    expect(out).not.toContain('Проверка')
    expect(out).not.toContain('охватывает все ключевые аспекты')
  })

  it('английский бланк тоже срезается', () => {
    const out = dehydrateScaffold('Task: explain. Method: analysis.\nExecution:\nSoak the gelatin.\nVerification: looks complete.')
    expect(out).toContain('Soak the gelatin.')
    expect(out).not.toMatch(/Verification/i)
    expect(out).not.toMatch(/^Task:/m)
  })

  it('нормальный человеческий ответ не трогает', () => {
    const human = 'Замочи желатин в холодной воде на 15 минут — иначе он растворится комками.\n\nПотом отожми и добавь в горячий сироп.'
    expect(dehydrateScaffold(human)).toBe(human)
  })

  it('не ломает markdown-список и код', () => {
    const md = '- сахар\n- сироп\n\n```sh\nnpm i\n```'
    expect(dehydrateScaffold(md)).toBe(md)
  })

  it('пустая строка остаётся пустой', () => {
    expect(dehydrateScaffold('')).toBe('')
  })

  it('не съедает двоеточие внутри обычного текста', () => {
    const t = 'Главное: не перегрей сироп.'
    expect(dehydrateScaffold(t)).toBe(t)
  })
})
