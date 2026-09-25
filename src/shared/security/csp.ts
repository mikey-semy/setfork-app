/**
 * CONTENT SECURITY POLICY ДЛЯ СКРИПТОВ — пока в режиме ОТЧЁТОВ.
 *
 * Форма — «строгий CSP» Google (web.dev/articles/strict-csp), а не перечень доверенных
 * хостов: в исследовании того же Google 94,7% всех различных политик обходились, а
 * 75,8% — именно из-за перечней хостов (Weichselbaum и др., «CSP Is Dead, Long Live
 * CSP!», CCS 2016). Скрипт исполняется,
 * только если несёт одноразовый `nonce` этого ответа; `'strict-dynamic'` передаёт доверие
 * скриптам, которые загрузил уже доверенный скрипт, — так работают чанки Next.js.
 * `https:` и `'unsafe-inline'` — запасной путь для старых браузеров: `'unsafe-inline'`
 * отключается присутствием nonce (CSP2+), а `https:` — присутствием `'strict-dynamic'`
 * (CSP3).
 *
 * Nonce ставит middleware на КАЖДЫЙ запрос (заголовок запроса), и Next.js сам вешает его
 * на свои скрипты: он разбирает `Content-Security-Policy` и `…-Report-Only` одинаково
 * (`app-render.js`, `getScriptNonceFromHeader`). Статическая страница nonce не получила
 * бы, но у нас их нет: корневой layout читает `headers()` и `cookies()`, так что все
 * страницы уже рендерятся на запрос и nonce не стоит ничего сверх этого.
 *
 * ⚠️ Режим отчётов — сознательно первым шагом (standards/tasks/conformance-fixes.md,
 * PR 4 в HQ): сломанный скрипт на проде хуже отсутствия CSP. Боевой заголовок — после
 * недели чистых отчётов, заменой имени заголовка в `CSP_HEADER`.
 *
 * `frame-ancestors` здесь НЕТ: он в next.config.mjs и уже боевой, а встраиваемая страница
 * его обходит. В Report-Only он и не работает:
 * Chromium пишет в консоль, что игнорирует его в политике отчётов.
 */

/** Имя заголовка ответа. Смена на `Content-Security-Policy` = включение блокировки. */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only'

/** Приёмник отчётов о нарушениях. */
export const CSP_REPORT_PATH = '/api/csp-report'

/** Заголовок запроса, по которому серверные компоненты берут nonce для своих `<script>`. */
export const NONCE_HEADER = 'x-nonce'

/** 128 бит случайности в base64 — нижняя граница, которую называет CSP3 для nonce. */
export function cspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Политика для одного ответа.
 *
 * `'unsafe-eval'` — только в разработке: React в dev восстанавливает стеки через `eval`,
 * в сборке его нет (так же в примере Next.js, guides/content-security-policy).
 * ⚠️ Отчёты — ТОЛЬКО через `report-uri`, без `report-to`. Браузер, понимающий оба,
 * берёт `report-to` и `report-uri` игнорирует, а живой проверкой (Chromium 149 на
 * http://localhost, подброшенный `<img onerror>`) `report-to` не доставил ни одного
 * отчёта за 70 секунд, тогда как `report-uri` — сразу. Возможно, на https `report-to`
 * и дошёл бы, но неделя наблюдения держится на проверенном пути: иначе чистая сводка
 * могла бы значить не «нарушений нет», а «Chromium молчит». `report-uri` устарел по
 * спецификации, но его шлют все браузеры.
 */
export function cspPolicy(nonce: string, dev = process.env.NODE_ENV === 'development'): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ')
}
