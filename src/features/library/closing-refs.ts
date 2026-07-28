/**
 * Закрывающие ссылки на задачи в тексте предложения: «closes #12», «закрывает #7».
 *
 * Правило то же, что у GitHub/GitLab/Gitea: ключевое слово + `#N`. Слово нужно
 * обязательно — просто `#12` это УПОМИНАНИЕ, и закрывать по нему задачу нельзя,
 * иначе любая ссылка «как в #12» молча закрывала бы чужую работу.
 *
 * Русские формы включены намеренно: описание предложения у нас пишут по-русски,
 * и правило, работающее только на английских словах, для владельца выглядело бы
 * как «не работает».
 */

// Английские — как у конкурентов (включая формы на -es/-ed); русские — наши.
const KEYWORDS = [
  'close',
  'closes',
  'closed',
  'closing',
  'fix',
  'fixes',
  'fixed',
  'fixing',
  'resolve',
  'resolves',
  'resolved',
  'resolving',
  'закрывает',
  'закрывают',
  'закрыть',
  'закрывая',
  'решает',
  'решают',
  'решить',
  'исправляет',
  'исправляют',
  'исправить',
]

// (ключевое слово) (двоеточие?) (пробелы) #N — регистр не важен.
// Границы слова — lookaround по \p{L}, а НЕ `\b`: `\b` в JS считает словом только
// ASCII, поэтому перед «закрывает» границы для него не существует и русские формы
// не срабатывали вовсе (поймано тестом).
const EDGE = String.raw`[\p{L}\p{N}_]`
const RE = new RegExp(String.raw`(?<!${EDGE})(?:${KEYWORDS.join('|')})(?!${EDGE})\s*:?\s+#(\d+)\b`, 'giu')

/** Номера задач, которые предложение закрывает при слиянии. Без дублей, по порядку. */
export function closingRefs(text: string): number[] {
  if (!text) return []
  const out: number[] = []
  for (const m of text.matchAll(RE)) {
    const n = Number(m[1])
    if (n > 0 && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * Дописать связь с задачей — то, что делает пикер «привязать задачу».
 *
 * Живёт РЯДОМ с разбором намеренно: синтаксис ссылки один, и вторая его копия в
 * экшене разошлась бы с этой при первом же новом ключевом слове.
 */
export function addClosingRef(text: string, n: number): string {
  if (closingRefs(text).includes(n)) return text
  const base = text.trimEnd()
  return base ? `${base}\ncloses #${n}` : `closes #${n}`
}

/** Убрать ровно ЭТУ связь, не трогая остальной текст и другие ссылки. */
export function removeClosingRef(text: string, n: number): string {
  if (!text) return text
  const one = new RegExp(String.raw`(?<!${EDGE})(?:${KEYWORDS.join('|')})(?!${EDGE})\s*:?\s+#${n}\b`, 'giu')
  return text
    .replace(one, '')
    // Осиротевшие пустые строки и хвостовые пробелы после выреза — иначе текст
    // постепенно обрастает дырами от привязок-отвязок.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
