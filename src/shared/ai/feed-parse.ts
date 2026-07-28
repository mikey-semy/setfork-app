/**
 * РАЗБОР ПОТОКА (RSS/Atom/JSON Feed) — чистая функция без сети.
 *
 * Зачем свой разбор, а не библиотека: нам нужны ровно четыре поля (заголовок, ссылка, дата,
 * короткое описание) из трёх форматов, и это тридцать строк регулярок против ещё одной
 * зависимости в общем `node_modules`, который в этом проекте трогать нельзя (он делится с
 * рабочей копией владельца, и установка ломает его дев-сервер).
 *
 * ЧТО МЫ СОЗНАТЕЛЬНО НЕ БЕРЁМ: тело статьи. Новости не под свободной лицензией — копировать
 * их текст нельзя ни в каком виде. Нам нужен ФАКТ события и адрес; формулировку специалист
 * пишет сам, а источник остаётся сноской (см. tracks/living-lists.md).
 */

export interface FeedItem {
  title: string
  url: string
  /** Дата публикации, если поток её дал. Без даты лента не может стареть. */
  publishedAt: Date | null
  /** Короткое описание из потока — ПОДСКАЗКА для отбора, а не контент списка. */
  hint: string
}

/** Снять CDATA и HTML-теги, свести пробелы: заголовки в потоках приходят как попало. */
function clean(raw: string, max = 400): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
  return m ? m[1] : null
}

/** Дата из потока: RFC-822 (RSS) и ISO (Atom) оба парсятся Date; мусор → null, а не «сейчас». */
function parseDate(raw: string | null): Date | null {
  if (!raw) return null
  const d = new Date(clean(raw, 60))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Ссылка Atom лежит в атрибуте href, у RSS — в тексте тега. */
function atomLink(entry: string): string {
  const alt = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(entry)
  if (alt) return alt[1]
  const any = /<link[^>]*href=["']([^"']+)["']/i.exec(entry)
  if (any) return any[1]
  return clean(tag(entry, 'link') ?? '', 500)
}

/**
 * Разбор ответа потока. Формат определяем по содержимому, а не по расширению адреса: половина
 * RSS-лент отдаётся по адресам без расширения, а Content-Type врёт (text/xml на Atom и т.п.).
 *
 * Возвращаем только элементы с заголовком И адресом: элемент без ссылки нельзя ни атрибутировать,
 * ни проверить, а без заголовка — нечего показывать. Порядок сохраняем как в потоке.
 */
export function parseFeed(body: string, limit = 40): FeedItem[] {
  const text = body.trim()
  if (!text) return []
  if (text.startsWith('{')) return parseJsonFeed(text, limit)

  // RSS: <item>, Atom: <entry> — берём то, что нашлось.
  const blocks = [...text.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]).slice(0, limit)
  const out: FeedItem[] = []
  for (const b of blocks) {
    const title = clean(tag(b, 'title') ?? '', 300)
    const url = /<entry[\s>]/i.test(b) ? atomLink(b) : clean(tag(b, 'link') ?? '', 500)
    if (!title || !/^https?:\/\//i.test(url)) continue
    out.push({
      title,
      url,
      publishedAt: parseDate(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date')),
      hint: clean(tag(b, 'description') ?? tag(b, 'summary') ?? '', 400),
    })
  }
  return out
}

/** JSON Feed 1.1 — у части источников только он. */
function parseJsonFeed(text: string, limit: number): FeedItem[] {
  try {
    const obj = JSON.parse(text) as { items?: unknown }
    const items = Array.isArray(obj.items) ? obj.items : []
    const out: FeedItem[] = []
    for (const raw of items.slice(0, limit)) {
      const it = (raw ?? {}) as Record<string, unknown>
      const title = clean(String(it.title ?? ''), 300)
      const url = String(it.url ?? it.id ?? '')
      if (!title || !/^https?:\/\//i.test(url)) continue
      out.push({
        title,
        url,
        publishedAt: parseDate(typeof it.date_published === 'string' ? it.date_published : null),
        hint: clean(String(it.summary ?? it.content_text ?? ''), 400),
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Ключ дедупа элемента: адрес без мусора отслеживания и без хвостового слэша. Один и тот же
 * материал приходит в двух лентах с разными utm-метками — по сырому адресу он выглядел бы
 * двумя новостями.
 */
export function feedItemKey(url: string): string {
  try {
    const u = new URL(url)
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|yclid|gclid|fbclid|ref|from)/i.test(p)) u.searchParams.delete(p)
    }
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}`
  } catch {
    return url.trim().toLowerCase()
  }
}
