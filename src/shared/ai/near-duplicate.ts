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

/**
 * КОРОТКИЕ СПИСКИ судим строже. На тексте из пяти значимых слов Жаккар — шум: два списка
 * «X: подготовка / X: основной шаг» делят служебные слова и дают 0.43, ничего общего по сути
 * не имея. Поэтому пока значимых слов мало, совпадением считается только почти-копия.
 * (Замечено на живом тесте, а не придумано: фикстура из двух шаблонных шагов ловилась как дубль.)
 */
export const MIN_STEMS_FOR_SOFT_THRESHOLD = 10
export const SHORT_TEXT_THRESHOLD = 0.7

/**
 * ТЕМА ОБЯЗАНА БЫТЬ СОПОСТАВИМА С ШАГАМИ. Совпадения одних шагов мало: у списков одного
 * ЖАНРА каркас общий по устройству («опиши роль», «ограничь инструменты», «проверь вывод»
 * у любого субагента), и сходство по шагам меряет жанр, а не предмет.
 *
 * Замер на живом корпусе (496 списков ИИ-инструментария, 13.08.2026):
 *
 *   | пары                                   | шаги | тема | тема/шаги |
 *   |----------------------------------------|------|------|-----------|
 *   | Accessibility checker ↔ API designer   | 0.88 | 0.23 | 0.26      | ← РАЗНЫЕ субагенты
 *   | Block rm -rf ↔ Announce active model   | 0.75 | 0.19 | 0.25      | ← РАЗНЫЕ хуки
 *   | Brainstorm ↔ Anonymize personal data   | 0.71 | 0.14 | 0.20      | ← РАЗНЫЕ скиллы
 *   | Auto-stage edited files ↔ Auto-Stage…  | 0.30 | 0.67 | 2.20      | ← настоящий дубль
 *
 * Видно, что различает не порог, а СООТНОШЕНИЕ: у дубля тема идёт наравне с шагами или
 * выше, у соседей по жанру она втрое-впятеро ниже. На 54 403 парах внутри жанров правило
 * «тема ≥ 0.6 × шаги» снижает ложные срабатывания с 780 (1.4%) до 42 (0.08%), не пропуская
 * ни одного дубля с сохранённой половиной лексики.
 *
 * Почему не абсолютный порог темы: он ломается на сильном перефразе — при переписанном на
 * две трети заголовке «тема ≥ 0.35» пропускает 97% настоящих дублей, тогда как
 * относительное правило — 2%.
 *
 * Цена ошибки несимметрична: ложное «дубль» ТИХО отбрасывает готовую работу (так на проде
 * 13.08 отсеялись 85 законных списков при переносе, и та же проверка стоит в самогенерации
 * компании), пропущенный дубль виден человеку в библиотеке и правится руками.
 */
export const TOPIC_TO_STEPS_RATIO = 0.6

/** Дубль ли это по соотношению «тема против шагов» (см. TOPIC_TO_STEPS_RATIO). */
export function sameTopic(stepScore: number, topicScore: number): boolean {
  return topicScore >= TOPIC_TO_STEPS_RATIO * stepScore
}

/**
 * Сходство ТЕМЫ: лучшее из «заголовок с тегами» и «только заголовок».
 *
 * Почему максимум, а не просто заголовок с тегами: теги — это метаданные, и различие в них
 * не должно ВЫЧИТАТЬСЯ из сходства. Два одинаковых списка, у которых проставлены разные
 * дополнительные теги, по общей мере дают тему втрое ниже реальной и перестают быть
 * дублями — то есть чужая небрежность в тегах прячет копию (находка авто-ревью на #784).
 * Замер: на 54 403 парах максимум добавляет 2 ложных срабатывания (44 против 42) и
 * закрывает этот случай целиком.
 */
export function topicSimilarity(a: { topic: Set<string>; title: Set<string> }, b: { topic: Set<string>; title: Set<string> }): number {
  return Math.max(jaccard(a.topic, b.topic), jaccard(a.title, b.title))
}

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

/** Текст ТЕМЫ: заголовок и теги — то, чем список отличается от соседа по жанру. */
export function topicText(list: { title: string; tags?: string[] }): string {
  return [list.title, ...(list.tags ?? [])].filter(Boolean).join(' \n ')
}

export interface NearDupCandidate {
  id: string
  title: string
  items: string[]
  tags?: string[]
}

export interface NearDupVerdict {
  /** Ближайший похожий список, если сходство по словам выше порога. */
  match: { id: string; title: string; score: number; phrases: number; topic: number } | null
  /** Лучшее сходство вообще — в журнал: видно «еле прошёл» или «и близко нет». */
  best: number
}

/**
 * Сравнение нового списка с существующими. Возвращает ближайший совпавший — отказаться или
 * пометить решает вызывающий. Порог один на систему: разные пороги в разных местах
 * разъезжаются, а «сколько именно» здесь проверяемо тестом.
 */
export function findNearDuplicate(
  fresh: { title: string; items: string[]; tags?: string[] },
  existing: NearDupCandidate[],
  threshold = NEAR_DUP_THRESHOLD,
): NearDupVerdict {
  const freshText = listText(fresh)
  const mine = wordSet(freshText)
  const minePhrases = shingles(freshText)
  const myTopic = wordSet(topicText(fresh))
  const myTitle = wordSet(fresh.title)
  let best = 0
  let match: NearDupVerdict['match'] = null
  let matchScore = 0
  for (const cand of existing) {
    const candText = listText(cand)
    const theirs = wordSet(candText)
    const score = jaccard(mine, theirs)
    const topic = topicSimilarity({ topic: myTopic, title: myTitle }, { topic: wordSet(topicText(cand)), title: wordSet(cand.title) })
    // Порог адаптивный: короткому тексту веры меньше (см. MIN_STEMS_FOR_SOFT_THRESHOLD).
    const need = Math.min(mine.size, theirs.size) < MIN_STEMS_FOR_SOFT_THRESHOLD ? Math.max(threshold, SHORT_TEXT_THRESHOLD) : threshold
    // «Самый похожий» и «совпавший» считаются РАЗДЕЛЬНО. Пока это было одним условием,
    // сосед по жанру с высшим сходством шагов закрывал собой настоящий дубль, идущий
    // следом с чуть меньшим: он поднимал планку `best`, а до проверки темы дело не
    // доходило вовсе (находка авто-ревью на #784).
    if (score > best) best = score
    if (score >= need && sameTopic(score, topic) && score > matchScore) {
      matchScore = score
      match = {
        id: cand.id,
        title: cand.title,
        score: Number(score.toFixed(3)),
        phrases: Number(jaccard(minePhrases, shingles(candText)).toFixed(3)),
        topic: Number(topic.toFixed(3)),
      }
    }
  }
  // best — максимум сходства по шагам среди ВСЕХ кандидатов (в журнал: «еле прошёл» или
  // «и близко нет»), match — лучший среди тех, кто прошёл оба условия. Это разные вопросы.
  return { match, best: Number(best.toFixed(3)) }
}
