import { DEFAULT_LANG, isLang, type Lang } from './index'

/**
 * Разбор `Accept-Language` — ОДИН на всё приложение.
 *
 * Копий было две, и обе неверные по-своему: серверный резолвер интерфейса перебирал
 * теги по порядку, а git-транспорт брал вообще первый тег — и обе выбрасывали веса `q`.
 * Для заголовка `ru;q=0.1,en;q=1.0` это означало русский, хотя клиент явно просил
 * английский (карточка ревью git/011).
 *
 * По RFC 9110 §12.5.4 порядок в заголовке приоритета не задаёт: приоритет задаёт `q`
 * (по умолчанию 1), а `q=0` — это ЗАПРЕТ языка, а не слабое предпочтение. Разбор чистый
 * (строка на входе, язык на выходе), поэтому проверяется таблицей без сети и Next.
 */
export function negotiateLang(header: string | null | undefined, fallback: Lang = DEFAULT_LANG): Lang {
  return preferredLang(header) ?? fallback
}

/**
 * Язык, который клиент ЯВНО назвал в `Accept-Language`, — или `null`, если не назвал ни одного
 * знакомого (заголовка нет, `*`, только чужие языки). Отличать «не назвал» от «английский»
 * нужно зрителю без предпочтения — роботу: ему страница списка отдаётся на языке самого списка
 * (ADR-0030), а не на английском по умолчанию.
 */
export function preferredLang(header: string | null | undefined): Lang | null {
  const ranked: { lang: Lang; q: number; order: number }[] = []
  let order = 0
  for (const raw of (header ?? '').split(',')) {
    const part = raw.trim()
    if (!part) continue
    const [tag, ...params] = part.split(';')
    // `ru-RU` → `ru`: подтег региона на выбор словаря не влияет.
    const code = tag.trim().slice(0, 2).toLowerCase()
    order += 1
    // `*` («любой») сам по себе языка не называет — в кандидаты не идёт; незнакомые
    // языки тоже пропускаем, а не считаем совпадением.
    if (!isLang(code)) continue
    // q=0 — явный отказ от языка: кандидатом он быть не может.
    const q = quality(params)
    if (q <= 0) continue
    ranked.push({ lang: code, q, order })
  }
  if (!ranked.length) return null
  // Больший вес важнее; при равном весе выигрывает тот, кто в заголовке раньше.
  ranked.sort((a, b) => b.q - a.q || a.order - b.order)
  return ranked[0].lang
}

/** `q=0.8` из параметров тега. Отсутствует или испорчено — значит 1 (RFC 9110). */
function quality(params: string[]): number {
  for (const p of params) {
    const [key, value] = p.split('=')
    if (key?.trim().toLowerCase() !== 'q') continue
    const q = Number(value)
    return Number.isFinite(q) ? q : 1
  }
  return 1
}

/**
 * Прислал ли клиент хоть какое-то языковое предпочтение. Пустой заголовок и `*` («любой») —
 * нет: так приходит робот поисковика, и ему страница списка отдаётся на языке самого списка
 * (ADR-0030). Любой названный язык — да, даже незнакомый нам.
 */
export function hasLangPreference(header: string | null | undefined): boolean {
  const h = (header ?? '').trim()
  return h !== '' && h !== '*'
}
