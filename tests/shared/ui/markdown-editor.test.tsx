import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Редактор разложен по механикам (правка текста, история, загрузки, ссылки на задачи).
 * Тест держит СВЯЗЬ этих частей: панель и горячие клавиши правят одно и то же поле, а
 * отмена возвращает предыдущий шаг — проверить это по отдельным чистым функциям нельзя.
 */
const { MarkdownEditor } = await import('@/shared/ui/MarkdownEditor')
const { TooltipProvider } = await import('@/shared/ui/Tooltip')

const editor = (lang: 'ru' | 'en' = 'en') => (
  <TooltipProvider>
    <MarkdownEditor name="body" lang={lang} />
  </TooltipProvider>
)

describe('MarkdownEditor', () => {
  it('кнопка панели оборачивает выделение, а не дописывает в конец', async () => {
    const user = userEvent.setup()
    render(editor())
    const field = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(field, 'привет мир')
    field.setSelectionRange(7, 10)
    await user.click(screen.getByRole('button', { name: /bold/i }))
    expect(field.value).toBe('привет **мир**')
  })

  it('Ctrl+B делает то же, что кнопка: одна механика на оба входа', async () => {
    const user = userEvent.setup()
    render(editor())
    const field = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(field, 'слово')
    field.setSelectionRange(0, 5)
    await user.keyboard('{Control>}b{/Control}')
    expect(field.value).toBe('**слово**')
  })

  it('отмена возвращает шаг до правки из панели', async () => {
    const user = userEvent.setup()
    render(editor())
    const field = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(field, 'текст')
    field.setSelectionRange(0, 5)
    await user.click(screen.getByRole('button', { name: /italic/i }))
    expect(field.value).toBe('_текст_')
    await user.keyboard('{Control>}z{/Control}')
    expect(field.value).toBe('текст')
  })

  it('вкладка «Просмотр» показывает разметку, а пустому полю честно говорит, что показывать нечего', async () => {
    const user = userEvent.setup()
    render(editor())
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()
  })

  it('подписи берутся из словаря — по-русски панель говорит по-русски', () => {
    render(editor('ru'))
    expect(screen.getByRole('button', { name: 'Написать' })).toBeInTheDocument()
    // Две соседние кнопки списков раньше обе назывались «список».
    expect(screen.getByRole('button', { name: 'список задач' })).toBeInTheDocument()
  })
})
