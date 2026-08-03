import { describe, it, expect } from 'vitest'
import { branchLabel, isServerBranch } from '@/features/git/branch-label'

/**
 * Подпись ветки. Правило одно на все поверхности (список предложений, страница
 * предложения, селектор веток) — здесь проверяется само правило, а не разметка.
 */
describe('подпись ветки', () => {
  it('серверную ветку называет словами, а не идентификатором', () => {
    const ref = 'u/0d5a3f6e-6a1c-4a25-9f5f-2b0a1c9d7e11/main'
    expect(isServerBranch(ref)).toBe(true)
    expect(branchLabel(ref, 'ru')).not.toContain('0d5a3f6e')
    expect(branchLabel(ref, 'en')).not.toContain('0d5a3f6e')
    // Оба языка обязаны сказать хоть что-то: пустая подпись читается как поломка.
    expect(branchLabel(ref, 'ru').trim().length).toBeGreaterThan(0)
    expect(branchLabel(ref, 'en').trim().length).toBeGreaterThan(0)
  })

  it('имя, придуманное человеком, оставляет как есть', () => {
    // `u/team/main` — настоящая ветка: владелец вправе завести её пушем из
    // терминала, и подпись у неё своя (авто-ревью fe#662).
    for (const ref of ['main', 'fix-typo', 'v2.1_draft', 'u', 'user/main', 'u/x/y/z', 'u/team/main', 'u/123/main']) {
      expect(isServerBranch(ref), ref).toBe(false)
      expect(branchLabel(ref, 'ru')).toBe(ref)
    }
  })
})
