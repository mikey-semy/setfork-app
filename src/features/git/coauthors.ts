/**
 * Трейлеры `Co-authored-by` для squash-коммита.
 *
 * При squash в main уезжает ОДИН коммит, и авторство промежуточных коммитов ветки
 * иначе исчезает бесследно: вклад был, а в истории его нет. GitHub решает это ровно
 * так же — списком трейлеров в сообщении.
 *
 * Логика повторяет `with_coauthors` в ядре (setfork-core/src/services/git_core.rs):
 * порядок появления, без дублей, служебная подпись сервиса не считается соавторством.
 * Расхождение здесь и там означало бы, что один и тот же squash даёт разные сообщения
 * в зависимости от того, какой путь включён.
 */

/** Подпись самого сервиса — не человек и соавтором быть не может. */
export const SERVICE_AUTHOR_EMAIL = 'git@setfork.com'

export interface CommitAuthor {
  name: string
  email: string
}

/** Строки трейлеров: по одной на автора, в порядке появления, без дублей. */
export function coauthorTrailers(authors: CommitAuthor[]): string[] {
  const seen: string[] = []
  for (const a of authors) {
    const name = a.name.trim()
    const email = a.email.trim()
    if (!name || !email) continue
    if (email.toLowerCase() === SERVICE_AUTHOR_EMAIL) continue
    const line = `Co-authored-by: ${name} <${email}>`
    if (!seen.includes(line)) seen.push(line)
  }
  return seen
}

/**
 * Заголовок + трейлеры одним сообщением коммита.
 *
 * Пустая строка перед трейлерами обязательна: без неё git не считает их трейлерами
 * и `git interpret-trailers` их не видит — а значит, и GitHub-подобные интеграции.
 */
export function withCoauthors(title: string, authors: CommitAuthor[]): string {
  const lines = coauthorTrailers(authors)
  if (lines.length === 0) return title
  return `${title}\n\n${lines.join('\n')}\n`
}
