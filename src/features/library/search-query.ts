// Разбор строки поиска с квалификаторами (как на GitHub): `docker by:demo tag:redis
// type:ordered stars:>100`. Всё, что не квалификатор — свободный текст.
// Чистая функция без БД — легко тестировать.

export interface ParsedQuery {
  text: string
  by?: string // автор (owner/author/by)
  tags: string[] // tag:/topic:
  type?: 'ordered' | 'unordered' // type:ordered
  minStars?: number // stars:>N
}

// ⚠️ `is` УБРАН ИЗ КЛЮЧЕЙ, а не просто лишён обработчика. Пока он оставался здесь без
// своего `case`, разбор ПРОГЛАТЫВАЛ токен: сохранённая ссылка `/search?q=is:verified`
// молча возвращала весь корпус — то есть отбор, снятый решением 0006, превращался в
// «показать всё», а не в поиск по словам.
//
// Незнакомый квалификатор ведёт себя иначе и правильно: `foo:bar` не совпадает с этим
// выражением и уходит в свободный текст. Именно так теперь и `is:verified` — человек
// увидит поиск по фразе, а не подмену.
//
// Почему `is:verified` снят вообще: публичный отбор «только проверенные» — тот же знак,
// что запрещён решением 0006, только фильтром. Он обещает вторую проверку сверх
// видимости, а её нет. Флаг остаётся внутренним инструментом модерации.
const KEY_RE = /^(by|owner|author|tag|topic|type|stars):(.*)$/i

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

/**
 * Обратная сборка строки поиска из структуры — чтобы фасеты писали квалификаторы
 * в единый `q` (как на GitHub). Round-trips с parseSearchQuery.
 */
export function buildSearchQuery(p: ParsedQuery): string {
  const parts: string[] = []
  if (p.text.trim()) parts.push(p.text.trim())
  if (p.by) parts.push(`by:${p.by}`)
  for (const tag of p.tags) parts.push(`tag:${tag}`)
  if (p.type) parts.push(`type:${p.type}`)
  if (p.minStars != null) parts.push(`stars:>${p.minStars}`)
  return parts.join(' ')
}
