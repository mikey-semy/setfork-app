import type { GitCommit } from '@/core'

/**
 * Разбор вывода `git log` с NUL-разделителями полей и \x01 между записями.
 *
 * Отдельный модуль ради теста: сообщение коммита многострочное и может содержать
 * любой печатный разделитель, поэтому формат держится на управляющих байтах —
 * такое надо проверять на примерах, а не на глаз.
 *
 * Формат (должен совпадать с FMT у вызывающего):
 *   %H %x00 %an %x00 %ae %x00 %at %x00 %p %x00 %B %x01
 */
export const GIT_LOG_FORMAT = '%H%x00%an%x00%ae%x00%at%x00%p%x00%B'
export const GIT_LOG_SEP = '\x01'

export function parseGitLog(stdout: string): GitCommit[] {
  return stdout
    .split(GIT_LOG_SEP)
    // git ставит \n после каждой записи — он попадает в начало следующей.
    .map((rec) => rec.replace(/^\n+/, ''))
    .filter((rec) => rec.includes('\x00'))
    .map((rec) => {
      const [sha, authorName, authorEmail, at, parents, ...rest] = rec.split('\x00')
      return {
        sha,
        // rest, а не [5]: NUL в сообщении не должен обрезать его на середине.
        message: rest.join('\x00').trim(),
        authorName,
        authorEmail,
        at: new Date(Number(at) * 1000),
        parents: parents.trim() ? parents.trim().split(/\s+/).length : 0,
      }
    })
}
