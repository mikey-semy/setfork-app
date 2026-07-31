import { describe, expect, it } from 'vitest'
import { TAG_RE, isReservedTag } from '@/features/releases/tag-name'

// #590: имена вида v12 заняты автоматическими тегами версий — по ним ядро
// считает, докуда версии записаны в git. Правила здесь — зеркальная пара с
// services/git_core.rs::is_version_tag (тесты «имена_версий_зарезервированы…»):
// расхождение означает, что фронт пропустит имя, которое ядро отвергнет, и
// пользователь снова упрётся в непонятную ошибку.

describe('isReservedTag', () => {
  it('резервирует ровно v<число> — как ядро', () => {
    for (const reserved of ['v1', 'v8', 'v20', 'v0', 'v000', 'v999999']) {
      expect(isReservedTag(reserved), reserved).toBe(true)
    }
  })

  it('человеческие имена с v остаются доступны', () => {
    for (const free of ['v1.0', 'v2-beta', 'v', 'version1', 'v1a', '1', 'v1_2', 'V1', 'stable']) {
      expect(isReservedTag(free), free).toBe(false)
    }
  })
})

describe('TAG_RE (форма имени)', () => {
  it('пропускает буквы/цифры и .-_ до 40 символов', () => {
    for (const ok of ['v1.0', 'v2-beta', 'stable', 'release_2026.07', 'a'.repeat(40)]) {
      expect(TAG_RE.test(ok), ok).toBe(true)
    }
  })

  it('режет пустое, пробелы, слэши и длинное', () => {
    for (const bad of ['', 'has space', 'a/b', 'тег', 'a'.repeat(41)]) {
      expect(TAG_RE.test(bad), bad).toBe(false)
    }
  })

  it('зарезервированное имя проходит проверку формы — потому и нужна отдельная', () => {
    expect(TAG_RE.test('v20')).toBe(true)
    expect(isReservedTag('v20')).toBe(true)
  })
})
