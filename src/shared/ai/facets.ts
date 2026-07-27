/**
 * ГРАНИ (facets) — чистая метрика многогранности: сколько РАЗНЫХ углов зрения принесли
 * участники совета и сколько из них дожило до финального списка.
 *
 * Здесь только счёт, без БД и без вызовов модели: сырьё (черновики) лежит в
 * generation_drafts, отчёт печатает scripts/facet-eval.ts. Разделение нужно затем, чтобы
 * метрику можно было проверить тестами на придуманных данных — иначе «замер» проверяет
 * сам себя своими же числами.
 *
 * Грань = набор ключевых слов пункта (нормализованный, без стоп-слов, с грубым стеммингом
 * RU/EN). Две грани считаются одной, если делят ≥2 ключа: «Проверить бэкапы БД» и
 * «проверьте бэкап базы» — один угол зрения, а не два.
 */
import type { CandidateItem } from '@/shared/db'

/** Стоп-слова обоих языков: без них «Проверить бэкап» и «проверьте бэкапы» — одна грань. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'your', 'you', 'it', 'is', 'be', 'do',
  'и', 'или', 'в', 'во', 'на', 'для', 'с', 'со', 'по', 'из', 'к', 'у', 'о', 'об', 'что', 'как', 'это', 'все',
])

/**
 * Грубая лемматизация RU/EN: режем окончания, чтобы «бэкапы»≈«бэкап», «диску»≈«диска»,
 * «настройте»≈«настроить», «checks»≈«check». Точность стеммера тут не самоцель: важно, чтобы
 * ОДИН угол зрения, названный двумя людьми по-разному, не считался двумя разными гранями —
 * иначе метрика показывает разнообразие там, где его нет.
 */
const SUFFIXES = [
  'айте', 'ойте', 'ями', 'ами', 'ого', 'его', 'ать', 'ять', 'ить', 'ешь', 'ите', 'ете', 'йте', 'ьте',
  'ing', 'ies', 'ов', 'ев', 'ах', 'ях', 'ой', 'ый', 'ий', 'ая', 'ое', 'ые', 'ие', 'ем', 'ом', 'ей', 'ся',
  'ю', 'я', 'ы', 'и', 'а', 'о', 'е', 'у', 'ь', 's',
]

export function stem(w: string): string {
  for (const suf of SUFFIXES) {
    // Порог 3 значимых символа: «диска» → «диск», но «дом» остаётся «дом».
    if (w.length > 3 + suf.length && w.endsWith(suf)) return w.slice(0, -suf.length)
  }
  return w
}

/** Ключевые слова строки — основа грани. Пусто, если после чистки ничего не осталось. */
export function keys(line: string): string[] {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem)
}

/**
 * Грани текста: по одной на строку-пункт. Черновики — свободный текст, поэтому берём
 * строки, похожие на пункт списка (нумерация/маркер/заголовок), а прозу отбрасываем.
 */
export function facetsOfDraft(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length < 6) continue
    // Пункт: «1. …», «- …», «• …», «**…**» либо короткая строка без точки в конце.
    const looksLikeItem = /^(\d+[.)]|[-*•—]|\*\*)/.test(line) || (line.length < 90 && !/[.!?]$/.test(line))
    if (!looksLikeItem) continue
    const k = keys(line.replace(/^(\d+[.)]|[-*•—]|\*+)\s*/, '')).slice(0, 4)
    if (k.length) out.add(k.sort().join('+'))
  }
  return out
}

/** Грани финального списка — по заголовкам пунктов (они уже структурированы). */
export function facetsOfFinal(items: CandidateItem[]): Set<string> {
  const out = new Set<string>()
  for (const it of items) {
    const k = keys(it.title ?? '').slice(0, 4)
    if (k.length) out.add(k.sort().join('+'))
  }
  return out
}

/** Пересечение по ЛЮБОМУ общему ключу: точное совпадение ключа-строки слишком строго. */
export const share = (a: string, set: Set<string>): boolean => {
  const aw = new Set(a.split('+'))
  for (const b of set) {
    const bw = b.split('+')
    const common = bw.filter((w) => aw.has(w)).length
    if (common >= Math.min(2, Math.min(aw.size, bw.length))) return true
  }
  return false
}

export interface FacetTally {
  /** Уникальные грани участника (нет ни в одном чужом черновике этого витка). */
  unique: string[]
  /** Из уникальных — доехавшие до финального списка. */
  delivered: string[]
  /** Все грани участника. */
  all: string[]
}

/**
 * Вклад одного участника витка: его грани, из них уникальные, из уникальных доехавшие.
 * Leave-one-out по участникам (arXiv 2605.27621): «минус участник i» отвечает на вопрос
 * «что потерялось бы без него» дешевле Шепли — а у нас всё уже записано, прогонов не надо.
 */
export function contribution(mine: Set<string>, others: Set<string>, final: Set<string>): FacetTally {
  const unique = [...mine].filter((f) => !share(f, others))
  return { all: [...mine], unique, delivered: unique.filter((f) => share(f, final)) }
}
