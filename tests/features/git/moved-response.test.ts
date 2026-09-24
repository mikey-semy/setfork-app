import { afterEach, describe, expect, it } from 'vitest'
import { gitMovedResponse } from '@/features/git/moved'

/**
 * «Репозиторий переехал» для git-клиента: адрес — от адреса САЙТА, а не от запроса.
 *
 * За прокси запрос приходит на привязку сервера (`0.0.0.0:3000`), и Location, собранный
 * из `req.url`, уводил git туда — `git clone` старой ссылки падал. Так было на проде
 * 24.09 после переименования review-kit → finetooth.
 */
const prev = process.env.APP_URL
afterEach(() => {
  process.env.APP_URL = prev
})

describe('gitMovedResponse', () => {
  it('Location — на адрес сайта, хвост и query целы, код 301', () => {
    process.env.APP_URL = 'https://setfork.example'
    const req = new Request('https://0.0.0.0:3000/miki/review-kit.git/info/refs?service=git-upload-pack')
    const res = gitMovedResponse(req, { owner: 'miki', slug: 'review-kit' }, 'miki/finetooth')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://setfork.example/miki/finetooth.git/info/refs?service=git-upload-pack')
  })
})

describe('publish_skill: слияние набора файлов', () => {
  it('режим прежнего файла переносится только в scripts/', async () => {
    const { mergeSkillFiles } = await import('@/features/mcp/tools/lists/skill')
    const bytes = (s: string) => new TextEncoder().encode(s)
    const current = [
      { path: 'scripts/run.sh', content: bytes('a'), executable: true },
      { path: 'assets/guard.sh', content: bytes('b'), executable: true }, // пришёл пушем раньше правила
    ]
    const given = [
      { path: 'scripts/run.sh', content: bytes('a2'), executable: false, execGiven: false },
      { path: 'assets/guard.sh', content: bytes('b2'), executable: false, execGiven: false },
    ]
    const merged = mergeSkillFiles(current, given, [], false)
    expect(merged.files.map((f) => [f.path, f.executable])).toEqual([
      ['scripts/run.sh', true],
      ['assets/guard.sh', false],
    ])
  })
})
