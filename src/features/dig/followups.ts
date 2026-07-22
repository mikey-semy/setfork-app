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
