import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⚠️ СТРАНИЦА, У КОТОРОЙ ЕСТЬ СВОЙ ЗАГОЛОВОК, ОБЯЗАНА ИМЕТЬ И СВОЮ КАРТОЧКУ.
 *
 * Next сливает метаданные ПОВЕРХНОСТНО: сегмент, объявивший `title`, но не объявивший
 * `openGraph`, наследует родительский `openGraph` целиком — вместе с чужим заголовком.
 * На экране страница называется правильно, а в мессенджере разворачивается как ссылка на
 * главную. Замер на проде 03.09.2026: у `/changelog`, `/explore`, `/tags`, `/trending` и
 * у страниц задач карточка была общесайтовой.
 *
 * Проверка держит ПУБЛИЧНЫЕ страницы — те, ссылку на которые отправляют. Личные и
 * служебные (админка, вход, настройки) в список не входят: их никто не расшаривает, а
 * узда, срабатывающая на семидесяти местах, — это узда, которую пролистывают.
 */
const SHAREABLE = [
  'src/app/page.tsx',
  'src/app/explore/page.tsx',
  'src/app/changelog/page.tsx',
  'src/app/tags/page.tsx',
  'src/app/trending/page.tsx',
  'src/app/collections/page.tsx',
  'src/app/[handle]/[slug]/page.tsx',
  'src/app/[handle]/[slug]/issues/page.tsx',
  'src/app/[handle]/[slug]/issues/[number]/page.tsx',
]

const read = (p: string) => readFileSync(p, 'utf8')

describe('карточка ссылки', () => {
  it('у публичных страниц она своя, а не общесайтовая', () => {
    const bad = SHAREABLE.filter((p) => {
      const s = read(p)
      // Либо через общий помощник, либо объявлен `openGraph` руками — оба способа честные.
      return !s.includes('pageMeta(') && !s.includes('openGraph')
    })
    expect(bad, 'эти страницы отдадут в мессенджер заголовок САЙТА вместо своего').toEqual([])
  })

  it('перечень не устарел: все перечисленные страницы существуют', () => {
    // Иначе переименованный файл выпадет из проверки молча — и она станет зелёной по
    // причине, не имеющей отношения к делу.
    for (const p of SHAREABLE) expect(() => statSync(p), `${p} не найден`).not.toThrow()
  })
})

describe('помощник метаданных', () => {
  it('заполняет обе карточки из одних строк', async () => {
    const { pageMeta } = await import('@/shared/seo/page-meta')
    const m = pageMeta({ title: 'Заголовок', description: 'Описание', path: '/где-то' })
    expect(m.openGraph?.title).toBe('Заголовок')
    expect(m.twitter?.title).toBe('Заголовок')
    // Описание не должно потеряться по дороге ни в одной из карточек.
    expect(m.openGraph?.description).toBe('Описание')
    expect(m.twitter?.description).toBe('Описание')
    expect(m.alternates?.canonical).toBe('/где-то')
  })

  it('без описания не подставляет чужое', () => {
    // Пустое поле лучше унаследованного: описание главной под чужим заголовком — ложь.
    return import('@/shared/seo/page-meta').then(({ pageMeta }) => {
      const m = pageMeta({ title: 'Только заголовок' })
      expect(m.description).toBeUndefined()
      expect(m.openGraph?.description).toBeUndefined()
    })
  })
})
