/** Места под вопросы в строке NEXT — ЕДИНСТВЕННЫЙ источник: отсюда собирается
 *  и образец для промпта, и фильтр заготовок в ответе (иначе они разъедутся). */
export const NEXT_SLOTS = ['first question', 'second question', 'third question'] as const
/** Образец строки NEXT, который видит модель (вставляется в промпт гнома). */
export const NEXT_TEMPLATE = `NEXT: ${NEXT_SLOTS.map((s) => `<${s}>`).join(' | ')}`

/** Скобки образца вокруг вопроса: модель то подставляет текст ВМЕСТО «<…>», то
 *  внутрь них — «<Почему именно winget?>». Во втором случае вопрос настоящий,
 *  и показывать его надо без скобок, а не выбрасывать. */
const unwrap = (s: string) => s.replace(/^[<[{]\s*/, '').replace(/\s*[>\]}]$/, '').trim()

/**
 * Заготовка из образца вместо живого вопроса: модель иногда копирует форму
 * строки NEXT дословно — гость видел кнопки «q1 | q2 | q3» (фидбек владельца).
 * Такие «вопросы» не показываем: пустой список — это сигнал поверхности
 * показать свои универсальные направления.
 */
const isPlaceholder = (s: string) => {
  const inner = s.toLowerCase()
  return !inner || (NEXT_SLOTS as readonly string[]).includes(inner) || /^(?:q|question|вопрос)\s*[-_]?\d+[.?]?$/.test(inner)
}

/**
 * Отделяет хвост «NEXT: …» (фоллоу-апы) от текста ответа гнома. Модель выдаёт
 * вопросы то в строку через «|», то СПИСКОМ с новой строки/маркерами — раньше
 * парсер знал только первый формат, и «NEXT:» с буллетами вылезал ТЕКСТОМ
 * (фидбек владельца). Берём всё после NEXT:, режем по «|» И по переносам,
 * чистим маркеры. Чистая функция (не в 'use server' chat-actions — там только async).
 */
export function parseFollowups(raw: string): { text: string; followups: string[] } {
  const nm = /\n?[ \t]*NEXT:[ \t]*([\s\S]*)$/i.exec(raw)
  if (!nm) return { text: raw, followups: [] }
  const followups = nm[1]
    .split(/\||\n/)
    .map((s) => unwrap(s.replace(/^[\s>*\-–—•\d.)\]]+/, '').trim()))
    .filter((s) => s && !isPlaceholder(s))
    .slice(0, 3)
  return { text: raw.slice(0, nm.index).trim(), followups }
}

/**
 * Отделяет реальный созыв «SUMMON: <id>» (MCP-подобное действие гнома: передать
 * вопрос коллеге) от текста передачи. id валидируется вызывающим по ростеру.
 */
export function parseSummon(raw: string): { text: string; summonId?: string } {
  const sm = /(?:^|\n)\s*SUMMON:\s*([a-z0-9_-]+)\s*$/i.exec(raw)
  if (!sm) return { text: raw }
  return { text: raw.slice(0, sm.index).trim(), summonId: sm[1].trim().toLowerCase() }
}
