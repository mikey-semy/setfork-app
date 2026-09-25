import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { parseGithubSkillUrl } = await import('@/features/library/skill-import/github')

// Адрес — такой же, какой принимает `npx skills add`; ходим только к GitHub.
describe('parseGithubSkillUrl', () => {
  it.each([
    ['https://github.com/anthropics/skills', { owner: 'anthropics', repo: 'skills', dir: '' }],
    ['github.com/anthropics/skills/tree/main/skills/pdf', { owner: 'anthropics', repo: 'skills', ref: 'main', dir: 'skills/pdf' }],
    ['https://github.com/a/b/blob/v1.2/x/SKILL.md', { owner: 'a', repo: 'b', ref: 'v1.2', dir: 'x' }],
    ['https://github.com/a/b/blob/main/SKILL.md', { owner: 'a', repo: 'b', ref: 'main', dir: '' }],
    ['a/b', { owner: 'a', repo: 'b', dir: '' }],
    ['a/b/skills/pdf', { owner: 'a', repo: 'b', dir: 'skills/pdf' }],
    ['https://github.com/a/b.git/', { owner: 'a', repo: 'b', dir: '' }],
  ])('%s', (url, want) => {
    expect(parseGithubSkillUrl(url)).toEqual(want)
  })

  it.each(['https://gitlab.com/a/b', 'https://evil.example/a/b', 'http://169.254.169.254/latest', 'github.com/a', 'https://github.com/a/b/blob/main/README.md', 'https://github.com/a/b/tree/main/../etc'])(
    'отказ: %s',
    (url) => {
      expect(parseGithubSkillUrl(url)).toHaveProperty('error')
    },
  )
})
