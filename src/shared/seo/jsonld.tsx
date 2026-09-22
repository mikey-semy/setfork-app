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

/**
 * САЙТ КАК ТАКОВОЙ: кто за ним стоит, как по нему искать, что это за продукт.
 *
 * Разметка в проекте была только у списков и профилей — у самого сайта ноль
 * (`application/ld+json` на главной не встречался ни разу). Аудит 22.09.2026, работа 2:
 * сниппет беднее конкурентского, строки поиска в выдаче нет, а главное — **разметка
 * нужна для попадания в ответы нейросетей**, где сайт без неё просто не разбирается.
 *
 * Три схемы дают три разных ответа: `Organization` — кто, `WebSite` — как искать,
 * `SoftwareApplication` — что за вещь и сколько стоит.
 */
export function organization(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'SetFork',
    url: SITE_ORIGIN,
    logo: absolute('/icon-512.png'),
    description: 'Canonical, runnable, versioned reference lists.',
  }
}

/**
 * `WebSite` с `SearchAction` — строка поиска по сайту прямо в выдаче.
 *
 * ⚠️ Адрес поиска берётся из ЖИВОГО маршрута (`/search?q=`), а не выдуман: шаблон,
 * указывающий в несуществующее место, хуже отсутствующего — поисковик покажет строку,
 * а она приведёт в 404.
 */
export function webSite(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SetFork',
    url: SITE_ORIGIN,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }
}

/** Продукт: что это, для кого и сколько стоит. Бесплатность объявляется явно — её не угадывают. */
export function softwareApplication(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SetFork',
    url: SITE_ORIGIN,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
}

/**
 * `HowTo` — САМОЕ ЦЕННОЕ для SetFork, и вот почему.
 *
 * Содержимое списка структурно совпадает с этой схемой один в один: шаги по порядку,
 * у каждого название и пояснение. Аудит называет это «редким совпадением, которое стоит
 * занять первым»: большинству сайтов `HowTo` приходится натягивать на текст, а здесь
 * она описывает ровно то, что есть.
 *
 * ⚠️ Схема применима ТОЛЬКО к упорядоченному списку с шагами. У неупорядоченного
 * («подборка ссылок») порядка нет, и объявлять его инструкцией — враньё разметки:
 * поисковик покажет «шаг 1 из 12» там, где никакого первого шага не существует.
 */
export function howTo(o: {
  name: string
  description?: string
  path: string
  steps: { name: string; text?: string }[]
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: o.name,
    ...(o.description ? { description: o.description } : {}),
    url: absolute(o.path),
    step: o.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      ...(s.text ? { text: s.text } : {}),
      url: `${absolute(o.path)}#${i + 1}`,
    })),
  }
}
