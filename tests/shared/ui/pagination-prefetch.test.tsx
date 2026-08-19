import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * ПРЕДЗАГРУЖАЕТСЯ ТОЛЬКО «ВПЕРЁД».
 *
 * По умолчанию Next тянет payload у каждой ссылки в поле зрения. У листалки ссылок до
 * девяти, поэтому предзагрузка включена точечно: соседняя страница вперёд — почти всегда
 * следующее действие, а «назад» приходят, УЖЕ побывав на предыдущей странице. Её payload
 * у браузера есть, вторая загрузка ничего не ускоряет и тратит трафик на каждом показе
 * листалки.
 *
 * Отдельным файлом, потому что настоящий `next/link` не выносит `prefetch` в DOM: это
 * его собственный проп, и снаружи он не виден. Значит, проверять надо то, что листалка
 * ПЕРЕДАЁТ, — а для этого ссылку приходится подменить. Подмена локальная: в соседнем
 * файле тесты идут с настоящим Link и проверяют разметку.
 */
vi.mock('next/link', () => ({
  default: ({
    href,
    prefetch,
    scroll,
    children,
    ...rest
  }: {
    href: string
    prefetch?: boolean
    scroll?: boolean
    children: React.ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} data-scroll={String(scroll)} {...rest}>
      {children}
    </a>
  ),
}))

const { Pagination } = await import('@/shared/ui/Pagination')

const href = (p: number) => `/x?page=${p}`

/** `undefined` = предзагрузка по умолчанию Next, то есть ВКЛЮЧЕНА. */
const prefetchOf = (name: RegExp): string | null =>
  screen.getByRole('link', { name }).getAttribute('data-prefetch')

describe('предзагрузка страниц листалки', () => {
  it('номерной режим: «вперёд» предзагружается, «назад» — нет', () => {
    render(<Pagination page={2} totalPages={5} makeHref={href} lang="en" />)
    expect(prefetchOf(/next/i)).toBe('undefined')
    expect(prefetchOf(/previous/i)).toBe('false')
  })

  it('номера страниц не предзагружаются вовсе', () => {
    // Иначе один показ листалки превращался бы в семь загрузок целых страниц ради
    // одного перехода.
    render(<Pagination page={2} totalPages={5} makeHref={href} lang="en" />)
    expect(prefetchOf(/page 4/i)).toBe('false')
  })

  it('режим keyset: правило то же', () => {
    render(<Pagination steps={{ prev: '/n?before=a', next: '/n?after=b' }} lang="en" />)
    expect(prefetchOf(/next/i)).toBe('undefined')
    expect(prefetchOf(/previous/i)).toBe('false')
  })
})

describe('листание не уводит страницу наверх', () => {
  /**
   * По умолчанию Next при переходе прокручивает документ к началу. Листалка стоит ПОД
   * выдачей, поэтому каждое нажатие «дальше» выбрасывало читателя вверх, и чтобы нажать
   * ещё раз, приходилось прокручивать обратно. Найдено владельцем на живом сайте.
   *
   * `scroll={false}` — тоже собственный проп Next, в DOM он не попадает; проверяется, как
   * и предзагрузка, через подменённую ссылку.
   */
  it.each([
    ['номерной режим', <Pagination key="n" page={2} totalPages={5} makeHref={href} lang="en" />],
    ['режим keyset', <Pagination key="k" steps={{ prev: '/n?before=a', next: '/n?after=b' }} lang="en" />],
  ])('%s', (_name, node) => {
    render(node)
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute('data-scroll', 'false')
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute('data-scroll', 'false')
  })
})
