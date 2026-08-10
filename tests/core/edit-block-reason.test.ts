import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { editBlockReason } from '@/core'

/**
 * Причину запрета записи знает ОДНА функция.
 *
 * Линза 11 (10.08.2026) нашла шесть мест, где причина выводилась на месте —
 * `archivedAt ? 'archived' : 'frozen'`: серверные экшены версий и предложений,
 * git-транспорт, хранилище списков. Копия знает меньше канона: она проверяет
 * ровно одно поле и молча считает «замороженным» всё остальное. Появится третья
 * причина запрета — соврут все шесть разом, и ни один тест этого не заметит.
 *
 * Поэтому здесь не только проверка самой функции, но и сторож: инлайн-вывод
 * причины в исходниках запрещён. Правило метода — корень с тремя и более
 * проявлениями обязан получить машинную проверку, иначе он отрастает заново.
 */
describe('причина запрета записи', () => {
  it('архив важнее заморозки: список и в архиве, и заморожен — причина «архив»', () => {
    expect(editBlockReason({ archivedAt: new Date(), frozenAt: new Date() })).toBe('archived')
  })

  it('только заморозка', () => {
    expect(editBlockReason({ archivedAt: null, frozenAt: new Date() })).toBe('frozen')
  })

  it('свободный список — причины нет', () => {
    expect(editBlockReason({ archivedAt: null, frozenAt: null })).toBeNull()
  })

  it('в исходниках не осталось инлайн-вывода причины', () => {
    // git grep -c возвращает ненулевой код, когда совпадений нет — это не ошибка.
    const found = execSync(`git grep -n "archivedAt ? 'archived' : 'frozen'" -- src || true`, { encoding: 'utf8' }).trim()
    expect(found, `причину выводят на месте вместо editBlockReason:\n${found}`).toBe('')
  })
})
