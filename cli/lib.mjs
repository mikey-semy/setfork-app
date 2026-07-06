// Чистые помощники sf CLI (без сайд-эффектов) — покрыты node:test.

export const DEFAULT_BASE = 'https://setfork.com'

/** База инстанса: SETFORK_URL или дефолт, без хвостовых слэшей. */
export function baseUrl(env = process.env) {
  return (env.SETFORK_URL || DEFAULT_BASE).trim().replace(/\/+$/, '')
}

const stripGit = (s) => s.replace(/\.git$/i, '')

/** "owner/slug" или полный URL https://host/owner/slug(/…) → {owner, slug}. */
export function parseRef(input) {
  if (!input || typeof input !== 'string') throw new Error('list reference required, e.g. owner/slug')
  const s = input.trim()
  const url = s.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)/i)
  if (url) return { owner: url[1], slug: stripGit(url[2]) }
  const parts = s.replace(/^\/+/, '').split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error(`bad list ref "${input}" (expected owner/slug)`)
  return { owner: parts[0], slug: stripGit(parts[1]) }
}

export function cloneUrl(ref, env) {
  const { owner, slug } = parseRef(ref)
  return `${baseUrl(env)}/${owner}/${slug}.git`
}
export function rawUrl(ref, env) {
  const { owner, slug } = parseRef(ref)
  return `${baseUrl(env)}/${owner}/${slug}/raw`
}
export function pageUrl(ref, env) {
  const { owner, slug } = parseRef(ref)
  return `${baseUrl(env)}/${owner}/${slug}`
}
