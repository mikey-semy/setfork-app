import { stem } from './facets'

/**
 * ПОЧТИ-ДУБЛИ — защита от свалки при массовой генерации.
 *
 * Дедуп по точному заголовку ловит только повтор одного и того же запроса. Компания,
 * генерирующая сотни списков, производит другое: «Как испечь хлеб дома» и «Печём хлеб дома
 * своими руками» с теми же шагами другими словами — два заголовка, один список. Владелец
 * назвал этот риск прямо: наполнять портал надо КАЧЕСТВЕННЕЕ, а не просто больше; свалка
 * похожих списков хуже, чем их отсутствие.
 *
 * Метод — шинглы и Жаккар, стандарт чистки корпусов (MinHash-семейство: NeMo Curator,
 * Distilabel и пр.). Считается КОДОМ по тексту, который у нас уже есть: ни вызовов модели, ни
 * эмбеддингов. Стеммер переиспользуем из метрики граней — второй в проекте не нужен.
 *
 * Почему не MinHash-подписи в базе: они нужны при сравнении миллионов против миллионов. У нас
 * один новый список против нескольких десятков близких по тегам — прямой Жаккар точнее и не
 * требует хранить подписи, которые пришлось бы пересчитывать на каждой правке списка.
 *
 * ПОРОГ ИЗМЕРЕН, а не выбран на глаз (калибровка 2026-07-27 на парах списков):
 *
 *   | пара                          | слова | 2-граммы | 3-граммы |
 *   |-------------------------------|-------|----------|----------|
 *   | копия слово-в-слово           | 1.00  | 1.00     | 1.00     |
 *   | переписан другими словами (RU)| 0.39  | 0.15     | 0.02     |
 *   | переписан другими словами (EN)| 0.53  | 0.18     | 0.05     |
 *   | та же тема, ДРУГОЙ список     | 0.10  | 0.00     | 0.00     |
 *   | другая тема                   | 0.00  | 0.00     | 0.00     |
 *
 * Отсюда: решает мера ПО СЛОВАМ (n-граммы фраз глухи к перефразу — 0.02 у настоящего
 * дубля), порог 0.30 лежит с запасом между «другой список» (0.10) и «переписанный дубль»
 * (0.39). Фразовая мера считается рядом как отдельная улика копипасты.
 *
 * ЧЕГО МЕТОД НЕ ЛОВИТ (честно, чтобы на него не полагались сверх меры): один и тот же список
 * на разных языках даёт 0.00 — межъязыковые дубли ищутся только эмбеддингами (у нас есть
 * векторный поиск, это отдельный рубеж).
 */

/** Порог по словам, выше которого список считается тем же самым. Измерен, см. таблицу. */
export const NEAR_DUP_THRESHOLD = 0.3

/** Значимые слова текста: без регистра, пунктуации, коротких обрывков; с грубым стеммингом. */
function stems(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map(stem)
}

/** Мера по СЛОВАМ — основная: устойчива к перефразу и смене порядка шагов. */
export function wordSet(text: string): Set<string> {
  return new Set(stems(text))
}

/** Мера по ФРАЗАМ (n-граммы слов) — улика копипасты: у перефраза она почти нулевая. */
export function shingles(text: string, n = 3): Set<string> {
  const w = stems(text)
  if (!w.length) return new Set()
  if (w.length <= n) return new Set([w.join(' ')])
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}

/** Жаккар: |пересечение| / |объединение|. 1 = наборы совпали. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let common = 0
  for (const x of a) if (b.has(x)) common++
  return common / (a.size + b.size - common)
}

/** Текст списка для сравнения: заголовок и пункты; порядок не важен. */
export function listText(list: { title: string; items: string[] }): string {
  return [list.title, ...list.items].filter(Boolean).join(' \n ')
}

export interface NearDupCandidate {
  id: string
  title: string
  items: string[]
}

export interface NearDupVerdict {
  /** Ближайший похожий список, если сходство по словам выше порога. */
  match: { id: string; title: string; score: number; phrases: number } | null
  /** Лучшее сходство вообще — в журнал: видно «еле прошёл» или «и близко нет». */
  best: number
}

/**
 * Сравнение нового списка с существующими. Возвращает ближайший совпавший — отказаться или
 * пометить решает вызывающий. Порог один на систему: разные пороги в разных местах
 * разъезжаются, а «сколько именно» здесь проверяемо тестом.
 */
export function findNearDuplicate(
  fresh: { title: string; items: string[] },
  existing: NearDupCandidate[],
  threshold = NEAR_DUP_THRESHOLD,
): NearDupVerdict {
  const freshText = listText(fresh)
  const mine = wordSet(freshText)
  const minePhrases = shingles(freshText)
  let best = 0
  let match: NearDupVerdict['match'] = null
  for (const cand of existing) {
    const candText = listText(cand)
    const score = jaccard(mine, wordSet(candText))
    if (score > best) {
      best = score
      match =
        score >= threshold
          ? { id: cand.id, title: cand.title, score: Number(score.toFixed(3)), phrases: Number(jaccard(minePhrases, shingles(candText)).toFixed(3)) }
          : match
    }
  }
  // Ближайший ниже порога не отменяет ранее найденное совпадение: match хранит именно
  // сработавшее, best — максимум по всем (это разные вопросы, и путать их нельзя).
  return { match, best: Number(best.toFixed(3)) }
}
