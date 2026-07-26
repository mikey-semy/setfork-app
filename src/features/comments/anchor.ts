// Якорь комментария к тексту внутри блока — и его пере-привязка после правок.
//
// Модель селекторов взята из W3C Web Annotation Data Model (Recommendation,
// 2017): храним ОДНОВРЕМЕННО позицию (TextPositionSelector: start/end) и цитату
// с контекстом (TextQuoteSelector: exact/prefix/suffix). Позиция — быстрый путь,
// цитата — путь восстановления: спека сама предупреждает, что позиция «очень
// хрупка к любым изменениям ресурса».
//
// Пере-привязка даёт не «да/нет», а УВЕРЕННОСТЬ: взвешенная оценка портирована
// из match-quote.ts клиента Hypothesis (BSD-2-Clause) — цитата 50, префикс 20,
// суффикс 20, позиция 2, бюджет ошибок min(256, длина/2). Именно эта идея —
// «показывать перепривязанное как догадку с уверенностью, а не как либо точное,
// либо осиротевшее» — рекомендована исследованием MSR-TR-2001-107.
//
// Поиск приблизительного вхождения — своя DP вместо бит-параллельного
// approx-string-match: якорь живёт внутри ОДНОГО поля блока (сотни символов),
// где O(n·m) незаметно, а лишняя зависимость нам дороже. Если поля вырастут —
// менять только approxSearch, контракт наружу не изменится.

/** Сколько символов контекста сохраняем с каждой стороны (как у Hypothesis). */
export const CONTEXT_LEN = 32

/** Веса оценки совпадения — портированы из Hypothesis match-quote.ts. */
const W_QUOTE = 50
const W_PREFIX = 20
const W_SUFFIX = 20
const W_POSITION = 2

/** Ниже этого совпадение считаем недостоверным — якорь осиротел. */
export const MIN_SCORE = 0.5

/** W3C-селекторы одного якоря. Поле блока указывается отдельно (см. AnchorTarget). */
export interface TextAnchor {
  /** TextQuoteSelector.exact — сама выделенная подстрока. */
  exact: string
  /** TextQuoteSelector.prefix/suffix — контекст для разрешения неоднозначности. */
  prefix: string
  suffix: string
  /** TextPositionSelector — быстрый путь; при правках устаревает первым. */
  start: number
  end: number
}

export type AnchorState = 'anchored' | 'reanchored' | 'orphaned'

/** Результат пере-привязки. Три состояния, а не два — «перепривязан» честно
 *  сообщает уверенность, вместо того чтобы притворяться точным или осиротеть. */
export type AnchorResolution =
  | { state: 'anchored'; start: number; end: number; confidence: 1 }
  | { state: 'reanchored'; start: number; end: number; confidence: number }
  | { state: 'orphaned' }

/** Снять якорь с выделения [start, end) в тексте. */
export function makeAnchor(text: string, start: number, end: number): TextAnchor {
  const s = Math.max(0, Math.min(start, text.length))
  const e = Math.max(s, Math.min(end, text.length))
  return {
    exact: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - CONTEXT_LEN), s),
    suffix: text.slice(e, Math.min(text.length, e + CONTEXT_LEN)),
    start: s,
    end: e,
  }
}

interface Match {
  start: number
  end: number
  errors: number
}

/**
 * Приблизительный поиск pattern в text с бюджетом ошибок (расстояние
 * Левенштейна). Возвращает по одному лучшему совпадению на «регион», чтобы
 * скользящие почти-дубликаты не забивали список кандидатов.
 */
function approxSearch(text: string, pattern: string, maxErrors: number): Match[] {
  const n = text.length
  const m = pattern.length
  if (!m || !n) return []

  // Классическая DP приблизительного поиска: старт свободный (нулевая строка
  // совпадает в любой позиции), поэтому row0 = 0. Параллельно тащим индекс
  // начала совпадения, иначе конец известен, а начало — нет.
  let prev = new Array<number>(n + 1).fill(0)
  let prevFrom = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array<number>(n + 1).fill(0)
  let curFrom = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    cur[0] = i
    curFrom[0] = 0
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (pattern[i - 1] === text[j - 1] ? 0 : 1)
      const del = prev[j] + 1 // символ шаблона пропущен
      const ins = cur[j - 1] + 1 // лишний символ текста
      if (sub <= del && sub <= ins) {
        cur[j] = sub
        curFrom[j] = prevFrom[j - 1]
      } else if (del <= ins) {
        cur[j] = del
        curFrom[j] = prevFrom[j]
      } else {
        cur[j] = ins
        curFrom[j] = curFrom[j - 1]
      }
    }
    ;[prev, cur] = [cur, prev]
    ;[prevFrom, curFrom] = [curFrom, prevFrom]
  }

  // prev — последняя посчитанная строка: ошибки совпадений, кончающихся в j.
  const out: Match[] = []
  for (let j = 1; j <= n; j++) {
    if (prev[j] > maxErrors) continue
    const cand: Match = { start: prevFrom[j], end: j, errors: prev[j] }
    const last = out[out.length - 1]
    // Тот же регион (совпадающее начало) — оставляем вариант с меньшей ошибкой.
    if (last && cand.start === last.start) {
      if (cand.errors < last.errors) out[out.length - 1] = cand
      continue
    }
    out.push(cand)
  }
  return out
}

/** Оценка 0..1 по весам Hypothesis: цитата + контекст + близость позиции. */
function scoreMatch(text: string, anchor: TextAnchor, match: Match): number {
  const quoteScore = 1 - match.errors / Math.max(1, anchor.exact.length)
  let raw = W_QUOTE * quoteScore
  let max = W_QUOTE

  if (anchor.prefix) {
    const actual = text.slice(Math.max(0, match.start - anchor.prefix.length), match.start)
    raw += W_PREFIX * similarity(actual, anchor.prefix)
    max += W_PREFIX
  }
  if (anchor.suffix) {
    const actual = text.slice(match.end, match.end + anchor.suffix.length)
    raw += W_SUFFIX * similarity(actual, anchor.suffix)
    max += W_SUFFIX
  }
  // Позиция — самый слабый сигнал (вес 2): подсказка, а не истина.
  const offset = Math.abs(match.start - anchor.start)
  raw += W_POSITION * Math.max(0, 1 - offset / Math.max(1, text.length))
  max += W_POSITION

  return raw / max
}

/** Похожесть двух коротких строк 0..1 (по общему хвосту/началу и длине). */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const len = Math.max(a.length, b.length)
  // Контекст сравниваем «изнутри наружу»: важнее символы, прилегающие к цитате.
  let same = 0
  for (let i = 1; i <= Math.min(a.length, b.length); i++) {
    if (a[a.length - i] === b[b.length - i]) same++
    else break
  }
  return same / len
}

/**
 * Найти якорь в НОВОМ тексте. Порядок как в клиенте Hypothesis: сначала дешёвая
 * проверка позиции, затем нечёткий поиск по цитате с оценкой уверенности.
 *
 * Известное свойство бюджета ошибок (длина/2): если ВНУТРЬ цитаты вставили
 * больше половины её длины, совпадение целиком в бюджет не влезает и якорь
 * садится на уцелевший фрагмент прежней цитаты. Комментарий остаётся в верном
 * месте текста, но выделение сжимается — это осознанный размен, тот же, что у
 * Hypothesis: расширять бюджет значит ловить ложные совпадения.
 */
export function resolveAnchor(anchor: TextAnchor, text: string): AnchorResolution {
  // Пустая цитата = комментарий к блоку целиком, а не к подстроке.
  if (!anchor.exact) return { state: 'anchored', start: 0, end: 0, confidence: 1 }

  // Быстрый путь: на старом месте лежит ровно та же подстрока.
  if (text.slice(anchor.start, anchor.end) === anchor.exact) {
    return { state: 'anchored', start: anchor.start, end: anchor.end, confidence: 1 }
  }

  const maxErrors = Math.min(256, Math.floor(anchor.exact.length / 2))
  const matches = approxSearch(text, anchor.exact, maxErrors)
  if (!matches.length) return { state: 'orphaned' }

  let best = matches[0]
  let bestScore = scoreMatch(text, anchor, best)
  for (const m of matches.slice(1)) {
    const s = scoreMatch(text, anchor, m)
    if (s > bestScore) {
      best = m
      bestScore = s
    }
  }
  if (bestScore < MIN_SCORE) return { state: 'orphaned' }

  // Точное совпадение цитаты, просто сдвинулась — это всё ещё «привязан».
  if (best.errors === 0 && text.slice(best.start, best.end) === anchor.exact) {
    return { state: 'anchored', start: best.start, end: best.end, confidence: 1 }
  }
  return { state: 'reanchored', start: best.start, end: best.end, confidence: Number(bestScore.toFixed(3)) }
}
