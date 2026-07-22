import 'server-only'
import { fetchPublicUrlDetailed } from '@/shared/lib/safe-fetch'
import { looksSoft404, type ProbeOutcome } from './classify'

// Одна вежливая проба URL: HEAD → фолбэк GET (многие сайты не умеют HEAD),
// жёсткий таймаут, честный UA, тело читается ограниченно и только когда нужно
// для soft-404. Паттерн — fetchLinkTitleAction (library/actions).

const PROBE_TIMEOUT_MS = 8_000
const BODY_CAP = 200_000
const UA = 'SetForkBot/1.0 (+https://setfork.com; link-check)'

async function attempt(url: string, method: 'HEAD' | 'GET'): Promise<{ out: ProbeOutcome; res: Response | null }> {
  const r = await fetchPublicUrlDetailed(url, {
    method,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8' },
  })
  if (!r.res) return { out: { status: null, netReason: r.reason, finalUrl: r.finalUrl }, res: null }
  return { out: { status: r.res.status, finalUrl: r.finalUrl }, res: r.res }
}

/** Проба URL. Инжектируемая (сигнатурой) — интеграционные тесты подменяют её. */
export async function probeUrl(url: string): Promise<ProbeOutcome> {
  // HEAD — дёшево (без тела); часть серверов на него врёт (405/403) или падает.
  const head = await attempt(url, 'HEAD')
  head.res?.body?.cancel().catch(() => {})
  const headOk = head.out.status != null && head.out.status >= 200 && head.out.status < 300
  const needGet =
    head.out.status == null || // сетевой отказ HEAD — вдруг GET пройдёт
    [405, 501, 403, 400].includes(head.out.status) || // «метод не поддержан»-класс
    headOk // 2xx: GET нужен для soft-404-проверки HTML

  if (!needGet) return head.out

  const get = await attempt(url, 'GET')
  if (!get.res) {
    // GET тоже не прошёл: если HEAD давал внятный HTTP-статус — верим ему.
    return head.out.status != null ? head.out : get.out
  }
  const status = get.out.status ?? 0
  let soft404 = false
  if (status >= 200 && status < 300 && (get.res.headers.get('content-type') ?? '').includes('html')) {
    try {
      const reader = get.res.body?.getReader()
      if (reader) {
        let html = ''
        while (html.length < BODY_CAP) {
          const { done, value } = await reader.read()
          if (done) break
          html += new TextDecoder().decode(value)
        }
        await reader.cancel().catch(() => {})
        soft404 = looksSoft404(html)
      }
    } catch {
      // тело не дочитали — не судим о soft-404
    }
  } else {
    get.res.body?.cancel().catch(() => {})
  }
  return { ...get.out, soft404 }
}

export type ProbeFn = typeof probeUrl
