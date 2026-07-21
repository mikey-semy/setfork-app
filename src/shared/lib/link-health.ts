import 'server-only'

/**
 * Здоровье ссылок (HQ §9): проверка — работа КОДА, не LLM (модель по URL не
 * ходит, она сочиняет). Используется после синтеза совета (фильтр битых refs
 * кандидата) и садовником (обход опубликованных списков).
 *
 * Осторожная классификация: «мёртвой» считаем только уверенную смерть
 * (404/410). Сетевые ошибки/таймауты/5xx → 'unknown' — с RU-сервера часть
 * зарубежных хостов недоступна или geo-блочится, полоть живое нельзя.
 */

const TIMEOUT_MS = 4000
const CONCURRENCY = 5
/** Кап на один список: генерация не должна ждать обхода бесконечных refs. */
const MAX_URLS = 20

export type LinkVerdict = 'ok' | 'dead' | 'unknown'

/** Классификация HTTP-статуса. Вынесено чисто — юнит-тестится без сети. */
export function classifyStatus(status: number): LinkVerdict {
  if (status === 404 || status === 410) return 'dead'
  if (status >= 200 && status < 400) return 'ok'
  // 401/403 (логин/бот-защита), 405/429/5xx — ссылка может быть живой.
  return 'unknown'
}

export async function checkUrl(url: string): Promise<LinkVerdict> {
  if (!/^https?:\/\//i.test(url)) return 'unknown' // не-HTTP (mailto и пр.) не проверяем
  const probe = async (method: 'HEAD' | 'GET') => {
    const r = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'SetForkLinkCheck/1.0 (+https://setfork.ru)' } })
    return r.status
  }
  try {
    let status = await probe('HEAD')
    // Многие серверы не умеют HEAD — перепроверяем GET'ом, прежде чем судить.
    if (status === 405 || status === 501 || status === 404) status = await probe('GET')
    return classifyStatus(status)
  } catch {
    return 'unknown'
  }
}

/** Проверить пачку URL с ограниченной параллельностью. Возвращает вердикт по каждому. */
export async function checkUrls(urls: string[]): Promise<Map<string, LinkVerdict>> {
  const unique = [...new Set(urls)].slice(0, MAX_URLS)
  const out = new Map<string, LinkVerdict>()
  let i = 0
  const worker = async () => {
    while (i < unique.length) {
      const url = unique[i++]
      out.set(url, await checkUrl(url))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker))
  return out
}

/**
 * Выкинуть УВЕРЕННО мёртвые refs из пунктов кандидата (мутирует). Возвращает
 * число удалённых — для реплики критика в ленте. 'unknown' не трогаем.
 */
export async function filterDeadRefs(items: { refs?: { label?: string; url: string }[] }[]): Promise<number> {
  const urls = items.flatMap((it) => (it.refs ?? []).map((r) => r.url)).filter(Boolean)
  if (!urls.length) return 0
  const verdicts = await checkUrls(urls)
  let removed = 0
  for (const it of items) {
    if (!it.refs?.length) continue
    const before = it.refs.length
    it.refs = it.refs.filter((r) => verdicts.get(r.url) !== 'dead')
    removed += before - it.refs.length
  }
  return removed
}
