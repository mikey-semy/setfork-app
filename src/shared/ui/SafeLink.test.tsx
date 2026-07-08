// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SafeLink } from './SafeLink'

// XSS-инвариант на уровне UI: пользовательский URL рендерится ссылкой ТОЛЬКО если
// safeHref его пропустил; иначе — неактивный <span> (клика нет). Дополняет
// safe-url.test.ts (сам предикат) проверкой самого компонента-чокпоинта.
describe('SafeLink', () => {
  it('безопасный https → <a> с href, target=_blank, rel=noreferrer по умолчанию', () => {
    render(<SafeLink href="https://example.com">link</SafeLink>)
    const a = screen.getByText('link')
    expect(a.tagName).toBe('A')
    expect(a).toHaveAttribute('href', 'https://example.com')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noreferrer')
  })

  it('относительный путь → <a>', () => {
    render(<SafeLink href="/acme/deploy">rel</SafeLink>)
    expect(screen.getByText('rel').tagName).toBe('A')
  })

  it.each(['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:msgbox', '  javascript:alert(1)'])(
    'опасная схема %s → <span>, не ссылка',
    (href) => {
      render(<SafeLink href={href}>x</SafeLink>)
      const el = screen.getByText('x')
      expect(el.tagName).toBe('SPAN')
      expect(el).not.toHaveAttribute('href')
    },
  )

  it.each([null, undefined, ''])('пустой href (%s) → <span>', (href) => {
    render(<SafeLink href={href}>y</SafeLink>)
    expect(screen.getByText('y').tagName).toBe('SPAN')
  })

  it('явные target/rel уважаются', () => {
    render(
      <SafeLink href="https://example.com" target="_self" rel="nofollow">
        z
      </SafeLink>,
    )
    const a = screen.getByText('z')
    expect(a).toHaveAttribute('target', '_self')
    expect(a).toHaveAttribute('rel', 'nofollow')
  })
})
