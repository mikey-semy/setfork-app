// Классификация исхода пробы URL — чистая логика (юнит-тестируется).
// Главный принцип (RU-egress): сервер стоит в РФ, часть хостов недостижима
// из-за SNI-блокировок ТСПУ — «не дошли по сети» НИКОГДА не эскалирует в
// broken, иначе массовые ложные «битые ссылки». broken зарабатывается только
// повторными HTTP-подтверждениями (404/410/dns/soft-404) в РАЗНЫХ свипах.

export type LinkVerdict = 'ok' | 'redirected' | 'broken' | 'unreachable' | 'uncheckable'

export interface ProbeOutcome {
  /** HTTP-статус (null — не дошли до HTTP: dns/сеть/SSRF-отказ). */
  status: number | null
  /** Причина сетевого уровня из fetchPublicUrlDetailed. */
  netReason?: 'bad_url' | 'private' | 'dns' | 'net' | 'too_many_redirects'
  /** Финальный URL после редиректов (отличается от исходного → redirected). */
  finalUrl?: string
  /** GET-тело выглядело как «страница не найдена» при 200 (soft-404). */
  soft404?: boolean
}

export interface Classified {
  verdict: LinkVerdict
  /** Машиночитаемая причина для журнала/админки. */
  reason: string
  /** Этот исход — кандидат в broken: инкрементирует failCount (раз за свип). */
  brokenCandidate: boolean
}

/** Соответствие «вердикт по одному наблюдению». Эскалацию (failCount →
 *  окончательный broken) делает вызывающий по nextVerdict(). */
export function classifyProbe(o: ProbeOutcome, changedUrl: boolean): Classified {
  // Сетевой уровень.
  if (o.status == null) {
    switch (o.netReason) {
      case 'bad_url':
      case 'private':
        // Мусорный/приватный URL — проверить нельзя, владельцу не показываем.
        return { verdict: 'uncheckable', reason: o.netReason, brokenCandidate: false }
      case 'dns':
        // NXDOMAIN — сильный сигнал смерти, но DNS флейкает: через эскалацию.
        return { verdict: 'unreachable', reason: 'dns', brokenCandidate: true }
      case 'too_many_redirects':
        return { verdict: 'broken', reason: 'redirect_loop', brokenCandidate: true }
      default:
        // timeout/reset/tls — с нашего egress не значит «мертво» (ТСПУ!).
        return { verdict: 'unreachable', reason: 'net', brokenCandidate: false }
    }
  }
  const s = o.status
  if (s === 404 || s === 410) return { verdict: 'broken', reason: `http_${s}`, brokenCandidate: true }
  if (s === 401 || s === 403 || s === 429 || s === 999)
    // Бот-блок/лимит — страница живая для людей; владельцу не показываем.
    return { verdict: 'uncheckable', reason: 'bot_block', brokenCandidate: false }
  if (s >= 500) return { verdict: 'unreachable', reason: `http_${s}`, brokenCandidate: false }
  if (s >= 200 && s < 300) {
    if (o.soft404) return { verdict: 'broken', reason: 'soft404', brokenCandidate: true }
    return changedUrl
      ? { verdict: 'redirected', reason: 'moved', brokenCandidate: false }
      : { verdict: 'ok', reason: 'ok', brokenCandidate: false }
  }
  // 3xx сюда не доходит (редиректы разворачивает fetch), 1xx/прочее — не судим.
  return { verdict: 'uncheckable', reason: `http_${s}`, brokenCandidate: false }
}

/** Итоговый вердикт с эскалацией: broken-кандидат становится broken только
 *  после brokenFails подряд неудачных СВИПОВ; любой успех сбрасывает счётчик. */
export function nextVerdict(c: Classified, failCount: number, brokenFails: number): { verdict: LinkVerdict; failCount: number } {
  if (c.verdict === 'ok' || c.verdict === 'redirected') return { verdict: c.verdict, failCount: 0 }
  const n = c.brokenCandidate ? failCount + 1 : failCount
  if (c.brokenCandidate && n >= brokenFails) return { verdict: 'broken', failCount: n }
  // Кандидат, не добравший подтверждений, публично числится unreachable
  // (не пугаем владельца преждевременным «битая»).
  return { verdict: c.verdict === 'broken' ? 'unreachable' : c.verdict, failCount: n }
}

/** Эвристика soft-404 по началу HTML (200, а страница — «не найдено»). */
export function looksSoft404(html: string): boolean {
  const head = html.slice(0, 4_000).toLowerCase()
  const title = /<title[^>]*>([^<]*)<\/title>/.exec(head)?.[1] ?? ''
  return /(404|not found|page not found|страница не найдена|не найдена|does not exist)/.test(title) || /class="[^"]*error-?404/.test(head)
}
