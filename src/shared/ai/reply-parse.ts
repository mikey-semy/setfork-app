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
    .map((s) => s.replace(/^[\s>*\-–—•\d.)\]]+/, '').trim())
    .filter(Boolean)
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
