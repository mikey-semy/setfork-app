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
      // `is:verified` СНЯТ. Публичный отбор «только проверенные» — тот же бейдж, только
      // фильтром: он обещает вторую проверку сверх видимости, а её нет (решение 0006).
      // Флаг остаётся внутренним инструментом модерации; снаружи по нему не отбирают.
      // Старый запрос `is:verified` теперь ОТБРАСЫВАЕТСЯ, как любой незнакомый
      // квалификатор: выдача перестаёт отбираться по флагу, слова в текст не попадают.
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
