import { SITE_ORIGIN } from '@/shared/site'

/**
 * Структурные данные (JSON-LD) — то, чем страница объясняет себя машине:
 * поисковику, превью-боту, ИИ-ассистенту.
 *
 * ⚠️ ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: `HowTo`. Разметка выглядит созданной ровно под
 * наши процедуры, но Google прекратил показывать её богатый результат в сентябре
 * 2023 — страница документации осталась, эффекта нет. Ставим то, что живо:
 * `BreadcrumbList`, `ItemList`, `CreativeWork`/`Article`, `ProfilePage`.
 *
 * ⚠️ Разметку получает ТОЛЬКО публично видимая страница. Структурные данные —
 * это данные: у черновика и приватного списка их быть не должно ровно по той же
 * причине, по которой их нет в карте сайта.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />
}

/**
 * Сериализация отдельной функцией — чтобы её можно было проверить тестом.
 *
 * Внутри `<script>` опасна одна последовательность — «</», закрывающая тег раньше
 * времени: название списка вида `</script><img onerror=…>` иначе разорвало бы
 * разметку. Экранируем «<» целиком — JSON остаётся валидным, а разорвать нечем.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

/** Абсолютный адрес: schema.org просит именно их, относительные молча игнорируются. */
export const absolute = (path: string) => `${SITE_ORIGIN}${path}`

/** Хлебные крошки. Живой богатый результат: путь виден прямо в выдаче. */
export function breadcrumbList(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absolute(it.path),
    })),
  }
}

/** Список чего угодно по порядку: шаги списка, списки тега, списки подборки. */
export function itemList(name: string, items: { name: string; path?: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      ...(it.path ? { url: absolute(it.path) } : {}),
    })),
  }
}

/** Сам список как произведение: автор, даты, теги. Даты важнее прочего — по ним
 *  видно, что справочник живой, а не написан однажды и брошен. */
export function creativeWork(o: {
  name: string
  description?: string
  path: string
  authorName: string
  authorPath: string
  datePublished?: Date | string
  dateModified?: Date | string
  tags?: string[]
  version?: number
}): Record<string, unknown> {
  const iso = (d?: Date | string) => (d instanceof Date ? d.toISOString() : d)
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: o.name,
    ...(o.description ? { description: o.description } : {}),
    url: absolute(o.path),
    author: { '@type': 'Person', name: o.authorName, url: absolute(o.authorPath) },
    ...(o.datePublished ? { datePublished: iso(o.datePublished) } : {}),
    ...(o.dateModified ? { dateModified: iso(o.dateModified) } : {}),
    ...(o.tags?.length ? { keywords: o.tags.join(', ') } : {}),
    ...(o.version ? { version: o.version } : {}),
    isPartOf: { '@type': 'WebSite', name: 'SetFork', url: SITE_ORIGIN },
  }
}

/** Страница профиля: кто автор корпуса. */
export function profilePage(o: { name: string; handle: string; description?: string }): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: o.name,
      alternateName: o.handle,
      url: absolute(`/${o.handle}`),
      ...(o.description ? { description: o.description } : {}),
    },
  }
}
