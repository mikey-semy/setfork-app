import { describe, expect, it } from 'vitest'
import { pageMeta, SITE_OG_IMAGE } from '@/shared/seo/page-meta'

/**
 * У КАРТОЧКИ ССЫЛКИ ВСЕГДА ЕСТЬ КАРТИНКА.
 *
 * Next сливает метаданные ПОВЕРХНОСТНО: `openGraph`, объявленный страницей, замещает
 * родительский целиком. Помощник объявлял его на каждой странице — и картинка из
 * корневого макета до страницы не доезжала, хотя комментарий рядом обещал обратное.
 *
 * Замер прода 22.09.2026: на главной не было ни `og:image`, ни `twitter:image`, при том
 * что в макете они заданы. Каждая ссылка на SetFork в мессенджере разворачивалась серым
 * прямоугольником — а продукт распространяется именно ссылками между разработчиками,
 * и это самый тёплый трафик, какой бывает.
 *
 * Проверяем обе карточки: у Twitter своя, и забыть одну из них легко — они рядом.
 */
describe('карточка ссылки', () => {
  it('без своей картинки берётся общесайтовая — и в og, и в twitter', () => {
    const m = pageMeta({ title: 'Лента', path: '/explore' }) as {
      openGraph: { images: { url: string }[] }
      twitter: { images: { url: string }[] }
    }
    expect(m.openGraph.images[0].url).toBe(SITE_OG_IMAGE)
    expect(m.twitter.images[0].url).toBe(SITE_OG_IMAGE)
  })

  it('своя картинка побеждает общесайтовую', () => {
    // Страницы списков рисуют картинку на лету, с названием на ней: общая там была бы
    // хуже, чем ничего — одинаковая карточка у тысячи разных ссылок.
    const m = pageMeta({ title: 'Список', path: '/a/b', image: '/a/b/opengraph-image' }) as {
      openGraph: { images: { url: string }[] }
      twitter: { images: { url: string }[] }
    }
    expect(m.openGraph.images[0].url).toBe('/a/b/opengraph-image')
    expect(m.twitter.images[0].url).toBe('/a/b/opengraph-image')
  })

  it('картинка есть даже у страницы без пути', () => {
    // `path` необязателен, и раньше его отсутствие заодно отменяло картинку: в одной
    // ветке условия отвечали и за адрес, и за карточку.
    const m = pageMeta({ title: 'Что-то' }) as { openGraph: { images: { url: string }[] } }
    expect(m.openGraph.images[0].url).toBe(SITE_OG_IMAGE)
  })

  it('у закрытой от индекса страницы карточка всё равно есть', () => {
    // `noindex` — про поисковики, а карточку рисует мессенджер: личную ссылку тоже
    // пересылают, и серый прямоугольник там так же неприятен.
    const m = pageMeta({ title: 'Настройки', noindex: true }) as { openGraph: { images: { url: string }[] } }
    expect(m.openGraph.images[0].url).toBe(SITE_OG_IMAGE)
  })
})
