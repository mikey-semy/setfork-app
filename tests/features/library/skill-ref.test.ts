import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { resolveSkillRef } = await import('@/features/library/skill-load')

// `?ref=` → номер версии: сначала тег релиза, потом `vN`; неизвестное — null (404).
describe('resolveSkillRef', () => {
  const versions = [1, 2, 3, 5]
  it('тег релиза — его версия', () => {
    expect(resolveSkillRef('v0.7.0', [{ tag: 'v0.7.0', version: 2 }], versions)).toBe(2)
  })
  it('релиз «v3» на пятую версию — пятая, как читает git (релизный тег ставится с force)', () => {
    expect(resolveSkillRef('v3', [{ tag: 'v3', version: 5 }], versions)).toBe(5)
  })
  it('vN — версия N, только если она есть', () => {
    expect(resolveSkillRef('v3', [], versions)).toBe(3)
    expect(resolveSkillRef('v4', [], versions)).toBeNull()
  })
  it.each(['v0', 'v01', '3', 'V3', 'v3 ', 'main', ''])('«%s» — не ссылка', (ref) => {
    expect(resolveSkillRef(ref, [], versions)).toBeNull()
  })
})
