/**
 * Вики-ссылки между списками (HQ §11, Obsidian-вектор): [[handle/slug]] в
 * описаниях и текстовых блоках превращается в обычную ссылку на список —
 * двусторонние связи вместо голых URL. Чистый модуль: парсинг и препроцессор
 * для Markdown; обратные ссылки собирает reindex (list_links).
 */

const WIKI_RE = /\[\[([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\]\]/gi

export interface WikiRef {
  handle: string
  slug: string
}

/** Все [[handle/slug]]-упоминания в тексте (без дублей, lowercase). */
export function extractWikiRefs(text: string): WikiRef[] {
  const seen = new Set<string>()
  const out: WikiRef[] = []
  for (const m of text.matchAll(WIKI_RE)) {
    const handle = m[1].toLowerCase()
    const slug = m[2].toLowerCase()
    const key = `${handle}/${slug}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ handle, slug })
    }
  }
  return out
}

/** Превратить [[handle/slug]] в markdown-ссылку — ПЕРЕД рендером Markdown.
 *  Подписи-«title» нет сознательно: резолв имён на каждый рендер дорог,
 *  а handle/slug — честный адрес (как в GitHub-упоминаниях). */
export function renderWikiLinks(text: string): string {
  return text.replace(WIKI_RE, (_, handle: string, slug: string) => `[${handle}/${slug}](/${handle.toLowerCase()}/${slug.toLowerCase()})`)
}
