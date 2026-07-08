import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Markdown } from '@/shared/ui/Markdown'

// XSS-инвариант рендера markdown: react-markdown (без rehype-raw) НЕ выполняет сырой
// HTML и санитизирует javascript:-ссылки. Тест фиксирует это как контракт компонента.
describe('Markdown', () => {
  it('рендерит базовый markdown (**bold** → <strong>)', () => {
    const { container } = render(<Markdown>{'**hi**'}</Markdown>)
    expect(container.querySelector('strong')?.textContent).toBe('hi')
  })

  it('сырой <script> из markdown НЕ становится <script>-узлом', () => {
    const { container } = render(<Markdown>{'text <script>alert(1)</script> more'}</Markdown>)
    expect(container.querySelector('script')).toBeNull()
  })

  it('javascript:-ссылка санитизируется (href не начинается с javascript:)', () => {
    const { container } = render(<Markdown>{'[x](javascript:alert(1))'}</Markdown>)
    const a = container.querySelector('a')
    // react-markdown обнуляет опасный href через defaultUrlTransform
    expect(a?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
  })

  it('пустой ввод → ничего не рендерит', () => {
    const { container } = render(<Markdown>{'   '}</Markdown>)
    expect(container.firstChild).toBeNull()
  })
})
