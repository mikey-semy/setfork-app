// Разбор строки поиска с квалификаторами (как на GitHub): `docker by:demo tag:redis
// is:verified type:ordered stars:>100`. Всё, что не квалификатор — свободный текст.
// Чистая функция без БД — легко тестировать.

export interface ParsedQuery {
  text: string
  by?: string // автор (owner/author/by)
  tags: string[] // tag:/topic:
  verified?: boolean // is:verified
  type?: 'ordered' | 'unordered' // type:ordered
  minStars?: number // stars:>N
}

const KEY_RE = /^(by|owner|author|tag|topic|is|type|stars):(.*)$/i

export function parseSearchQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: '', tags: [] }
  const words: string[] = []
  for (const tok of (raw || '').trim().split(/\s+/).filter(Boolean)) {
    const m = KEY_RE.exec(tok)
    if (!m) {
      words.push(tok)
      continue
    }
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (!val) continue
    switch (key) {
      case 'by':
      case 'owner':
      case 'author':
        out.by = val.replace(/^@/, '')
        break
      case 'tag':
      case 'topic':
        out.tags.push(val.toLowerCase())
        break
      case 'is':
        if (val.toLowerCase() === 'verified') out.verified = true
        break
      case 'type':
        if (val === 'ordered' || val === 'unordered') out.type = val
        break
      case 'stars': {
        const n = parseInt(val.replace(/^[>=<]+/, ''), 10)
        if (Number.isFinite(n)) out.minStars = n
        break
      }
    }
  }
  out.text = words.join(' ')
  return out
}
