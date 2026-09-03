import type { Metadata } from 'next'

/**
 * МЕТАДАННЫЕ СТРАНИЦЫ, ВКЛЮЧАЯ КАРТОЧКУ ССЫЛКИ.
 *
 * ⚠️ NEXT СЛИВАЕТ МЕТАДАННЫЕ ПОВЕРХНОСТНО. Сегмент, объявивший `title`, но не
 * объявивший `openGraph`, наследует родительский `openGraph` ЦЕЛИКОМ — вместе с чужим
 * заголовком и описанием. На экране страница называется правильно, а в мессенджере
 * разворачивается как ссылка на главную: «SetFork — versioned, runnable lists».
 *
 * Замер на проде 03.09.2026: `/changelog`, `/explore`, `/tags`, `/trending`, страницы
 * задач и версий любого списка — у всех карточка была общесайтовой. У самих списков её
 * починили точечно ещё 28.08, и комментарий там объясняет ровно это; но правило осталось
 * в одном файле, поэтому все остальные страницы продолжали наследовать чужую карточку.
 *
 * Поэтому здесь функция, а не памятка: заголовок и описание задаются ОДИН раз и
 * расходятся во все три места — вкладку браузера, карточку OpenGraph и карточку Twitter.
 *
 * ⚠️ ЯЗЫК КАРТОЧКИ — ЯЗЫК ОТВЕТА. Предпросмотрщик мессенджера не присылает
 * `Accept-Language` никогда, поэтому карточка у него всегда на языке по умолчанию. Это не
 * дефект функции: вызывающий передаёт уже переведённые строки, и если однажды мы решим
 * отдавать ботам другой язык, менять придётся согласование языка, а не это место.
 */
export function pageMeta(o: {
  /** Заголовок страницы. Шаблон корня добавит « · SetFork» во вкладке. */
  title: string
  description?: string
  /** Путь для canonical и `og:url`. Без него ссылки не переписываем. */
  path?: string
  /** Своя картинка карточки; по умолчанию — общесайтовая из корневого layout. */
  image?: string
  /** Страница не для индекса (личные разделы, служебные экраны). */
  noindex?: boolean
}): Metadata {
  const { title, description, path, image, noindex } = o
  const images = image ? [{ url: image }] : undefined
  return {
    title,
    ...(description ? { description } : {}),
    ...(path ? { alternates: { canonical: path } } : {}),
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: 'website',
      siteName: 'SetFork',
      title,
      ...(description ? { description } : {}),
      ...(path ? { url: path } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      ...(description ? { description } : {}),
      ...(images ? { images } : {}),
    },
  }
}
