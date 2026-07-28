import { describe, expect, it } from 'vitest'
import { feedItemKey, parseFeed } from '@/shared/ai/feed-parse'

// Разбор потока. Проверяем на настоящих формах, которые встречаются в жизни: RSS с CDATA,
// Atom со ссылкой в атрибуте, JSON Feed. И главное — что мы НЕ берём тело статьи: новости не
// под свободной лицензией, нам нужен факт и адрес, а формулировка своя.

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Канал</title>
  <item>
    <title><![CDATA[Вышел Postgres 19]]></title>
    <link>https://example.com/pg19?utm_source=rss&utm_medium=feed</link>
    <pubDate>Mon, 27 Jul 2026 09:00:00 +0000</pubDate>
    <description><![CDATA[<p>Кратко: <b>новый</b> планировщик</p>]]></description>
  </item>
  <item>
    <title>Без ссылки</title>
    <description>элемент, который нельзя атрибутировать</description>
  </item>
</channel></rss>`

const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Релиз инструмента</title>
    <link rel="alternate" href="https://example.org/release"/>
    <published>2026-07-26T12:30:00Z</published>
    <summary>короткая выжимка</summary>
  </entry>
</feed>`

const jsonFeed = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  items: [
    { title: 'Новость дня', url: 'https://example.net/news/1', date_published: '2026-07-25T08:00:00Z', summary: 'выжимка' },
    { title: 'Без адреса' },
  ],
})

describe('RSS', () => {
  it('берёт заголовок, ссылку, дату и подсказку; CDATA и теги снимаются', () => {
    const [it0] = parseFeed(rss)
    expect(it0.title).toBe('Вышел Postgres 19')
    expect(it0.url).toContain('https://example.com/pg19')
    expect(it0.publishedAt?.getUTCFullYear()).toBe(2026)
    expect(it0.hint).toBe('Кратко: новый планировщик')
  })

  it('элемент без ссылки отбрасывается — его нельзя ни атрибутировать, ни проверить', () => {
    expect(parseFeed(rss)).toHaveLength(1)
  })
})

describe('Atom и JSON Feed', () => {
  it('Atom: ссылка из атрибута href', () => {
    const [e] = parseFeed(atom)
    expect(e.url).toBe('https://example.org/release')
    expect(e.publishedAt?.toISOString()).toBe('2026-07-26T12:30:00.000Z')
  })

  it('JSON Feed разбирается, элемент без адреса отбрасывается', () => {
    const items = parseFeed(jsonFeed)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Новость дня')
  })

  it('формат определяется по содержимому, а не по расширению адреса', () => {
    expect(parseFeed(atom)).toHaveLength(1)
    expect(parseFeed(jsonFeed)).toHaveLength(1)
  })
})

describe('устойчивость', () => {
  it('пустой и мусорный вход — пусто, а не исключение', () => {
    expect(parseFeed('')).toEqual([])
    expect(parseFeed('не xml и не json')).toEqual([])
    expect(parseFeed('{битый json')).toEqual([])
  })

  it('битая дата → null, а не «сейчас»: иначе старьё выглядело бы свежим', () => {
    const feed = rss.replace('Mon, 27 Jul 2026 09:00:00 +0000', 'когда-то давно')
    expect(parseFeed(feed)[0].publishedAt).toBeNull()
  })

  it('подсказка ограничена по длине — это подсказка для отбора, а не контент', () => {
    const long = rss.replace('<p>Кратко: <b>новый</b> планировщик</p>', 'я'.repeat(2000))
    expect(parseFeed(long)[0].hint.length).toBeLessThanOrEqual(400)
  })

  it('предел числа элементов соблюдается', () => {
    const many = `<rss><channel>${'<item><title>т</title><link>https://e.com/a</link></item>'.repeat(50)}</channel></rss>`
    expect(parseFeed(many, 10)).toHaveLength(10)
  })
})

describe('ключ дедупа', () => {
  it('метки отслеживания и хвостовой слэш различием не считаются', () => {
    expect(feedItemKey('https://example.com/a/?utm_source=x&utm_medium=y')).toBe(feedItemKey('https://example.com/a'))
    expect(feedItemKey('https://www.example.com/a')).toBe(feedItemKey('https://example.com/a'))
  })

  it('значимые параметры сохраняются — это разные страницы', () => {
    expect(feedItemKey('https://example.com/a?id=1')).not.toBe(feedItemKey('https://example.com/a?id=2'))
  })

  it('якорь не различает: это одна страница', () => {
    expect(feedItemKey('https://example.com/a#part2')).toBe(feedItemKey('https://example.com/a'))
  })

  it('мусорный адрес не роняет ключ', () => {
    expect(feedItemKey('не адрес')).toBe('не адрес')
  })
})

describe('разметка в подсказке (найдено на живых лентах)', () => {
  // kubernetes.io отдаёт описание ЭКРАНИРОВАННЫМ. При одной чистке теги оживали уже ПОСЛЕ
  // вырезания — подсказка приезжала как «<p>Kubernetes ships with…» и уехала бы в промпт.
  it('экранированная разметка снимается, а не оживает', () => {
    const xml = `<rss><channel><item>
      <title>Custom metrics exporter</title>
      <link>https://kubernetes.io/blog/a/</link>
      <description>&lt;p&gt;Kubernetes ships with built-in awareness&lt;/p&gt;</description>
    </item></channel></rss>`
    const [it] = parseFeed(xml)
    expect(it.hint).toBe('Kubernetes ships with built-in awareness')
    expect(it.hint).not.toContain('<')
  })

  it('разметка внутри CDATA тоже снимается', () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[Заголовок]]></title>
      <link>https://a.example/x</link>
      <description><![CDATA[<p>Текст <b>жирным</b></p>]]></description>
    </item></channel></rss>`
    expect(parseFeed(xml)[0].hint).toBe('Текст жирным')
  })

  it('намеренно экранированный текст остаётся текстом, а не считается тегом', () => {
    // &amp;lt;p&amp;gt; — автор ХОТЕЛ показать разметку буквами. Раскодируй &amp; первым, и мы
    // выкинули бы его текст как тег.
    const xml = `<rss><channel><item>
      <title>Про теги</title>
      <link>https://a.example/tags</link>
      <description>Пиши &amp;lt;p&amp;gt; для абзаца</description>
    </item></channel></rss>`
    expect(parseFeed(xml)[0].hint).toBe('Пиши &lt;p&gt; для абзаца')
  })
})
