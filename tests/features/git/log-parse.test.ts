import { describe, expect, it } from 'vitest'
import { GIT_LOG_SEP, parseGitLog } from '@/features/git/log-parse'

// Запись в том виде, в каком её отдаёт git с нашим --format (без завершающего \n
// внутри полей): sha, автор, почта, время, родители, сообщение.
function rec(sha: string, msg: string, parents = 'aaa', at = 1_700_000_000): string {
  return ['0'.repeat(40 - sha.length) + sha, 'Кто-то', 's@example.com', String(at), parents, msg].join('\x00')
}

describe('parseGitLog', () => {
  it('разбирает записи и считает родителей', () => {
    // git ставит \n после каждой записи — он попадает в начало следующей.
    const out = parseGitLog(`${rec('a1', 'первый')}${GIT_LOG_SEP}\n${rec('b2', 'merge', 'aaa bbb')}${GIT_LOG_SEP}\n`)
    expect(out).toHaveLength(2)
    expect(out[0].sha.endsWith('a1')).toBe(true)
    expect(out[0].message).toBe('первый')
    expect(out[0].authorName).toBe('Кто-то')
    expect(out[0].at.getTime()).toBe(1_700_000_000_000)
    expect(out[0].parents).toBe(1)
    expect(out[1].parents).toBe(2) // merge-коммит
  })

  it('корневой коммит — ноль родителей', () => {
    expect(parseGitLog(`${rec('c3', 'корень', '')}${GIT_LOG_SEP}\n`)[0].parents).toBe(0)
  })

  it('многострочное сообщение сохраняется целиком', () => {
    const body = 'заголовок\n\nтело с\nпереносами'
    expect(parseGitLog(`${rec('d4', body)}${GIT_LOG_SEP}\n`)[0].message).toBe(body)
  })

  it('пустой вывод (нет коммитов сверх базы) — пустой список', () => {
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('\n')).toEqual([])
  })
})
