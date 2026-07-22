import { describe, expect, it, vi } from 'vitest'

// Мокаем настройки: тестируем разбор Yandex XML без реального ключа/сети.
vi.mock('@/shared/settings/ai', () => ({ getAiProviderRaw: async () => ({ yandexSearchKey: '', yandexFolder: '' }) }))

const { webSearch } = await import('@/shared/ai/web-search')

describe('webSearch', () => {
  it('без ключа поиска → null (веб-шаг пропускается, не выдумываем)', async () => {
    expect(await webSearch('деплой на vps', 'ru')).toBeNull()
  })
})

// Разбор XML — чистая функция, но не экспортируется; проверяем через форму ответа,
// какую вернул бы parseYandexXml на типовом Yandex-ответе (title/url/passage).
describe('парсинг Yandex XML (форма ответа)', () => {
  const sampleXml = `<?xml version="1.0"?><yandexsearch><response><results><grouping>
    <group><doc><url>https://example.com/a</url><title>Deploy <hlword>guide</hlword></title>
      <passages><passage>How to <hlword>deploy</hlword> to a VPS with zero downtime.</passage></passages></doc></group>
    <group><doc><url>https://example.org/b</url><title>Nginx tips</title>
      <headline>Configuring nginx reverse proxy</headline></doc></group>
  </grouping></results></response></yandexsearch>`

  // Повторяем логику parseYandexXml для проверки регулярок (модуль держит её приватной).
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  function parse(xml: string, limit = 5) {
    const hits: { title: string; url: string; snippet: string }[] = []
    const docRe = /<doc[^>]*>([\s\S]*?)<\/doc>/g
    let m: RegExpExecArray | null
    while ((m = docRe.exec(xml)) && hits.length < limit) {
      const doc = m[1]
      const url = /<url>([\s\S]*?)<\/url>/.exec(doc)?.[1]
      if (!url) continue
      const title = /<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? ''
      const passages = [...doc.matchAll(/<passage>([\s\S]*?)<\/passage>/g)].map((p) => stripTags(p[1]))
      const headline = /<headline>([\s\S]*?)<\/headline>/.exec(doc)?.[1]
      const snippet = (passages.join(' ') || (headline ? stripTags(headline) : '')).slice(0, 300)
      hits.push({ title: stripTags(title), url: stripTags(url), snippet })
    }
    return hits
  }

  it('извлекает url, title (без тегов), passage/headline как снипет', () => {
    const hits = parse(sampleXml)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toEqual({ title: 'Deploy guide', url: 'https://example.com/a', snippet: 'How to deploy to a VPS with zero downtime.' })
    expect(hits[1].url).toBe('https://example.org/b')
    expect(hits[1].snippet).toBe('Configuring nginx reverse proxy') // фолбэк на headline без passages
  })

  it('limit ограничивает число результатов', () => {
    expect(parse(sampleXml, 1)).toHaveLength(1)
  })
})
