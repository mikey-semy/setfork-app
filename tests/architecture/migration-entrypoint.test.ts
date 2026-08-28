import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ПРОД-МИГРАЦИЯ ЗАПУСКАЕТСЯ РОВНО ОДНИМ СПОСОБОМ.
 *
 * scripts/migrate-push.ts — модуль: тест зовёт из него clearDanglingForks, и импорт
 * не должен применять схему к базе из DATABASE_URL. Значит вызова main() на верхнем
 * уровне там быть не может. Обратная опасность дороже: если точка входа перестанет
 * звать main, контейнер миграции завершится успешно, не сделав НИЧЕГО, — а «успешный»
 * деплой без дела на этом проекте уже случался. Поэтому проверяются оба конца:
 * модуль молчит, точка входа существует и на неё смотрит Dockerfile.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('точка входа прод-миграции', () => {
  it('в модуле нет запуска main на верхнем уровне', () => {
    const src = read('scripts/migrate-push.ts')
    const topLevelCall = src.split('\n').filter((l) => /^\s{0,2}main\(\)/.test(l))
    expect(topLevelCall, 'импорт из модуля запустил бы прод-миграцию').toEqual([])
  })

  it('preflight не потерял шаг чистки висячих ссылок', () => {
    // Своя проверка у clearDanglingForks есть (tests/scripts/dangling-forks.itest.ts),
    // но она зовёт функцию напрямую. Убери вызов из main — тест останется зелёным, а
    // деплой встанет на ADD FOREIGN KEY. Здесь проверяется именно ВЫЗОВ.
    const src = read('scripts/migrate-push.ts')
    expect(src).toMatch(/await clearDanglingForks\(pool\)/)
    // Второй такой шаг — чистка висячих откатов перед ключом на revert_of_id.
    expect(src).toMatch(/await clearDanglingReverts\(pool\)/)
  })

  it('Dockerfile зовёт существующую точку входа, и она зовёт main', () => {
    const cmd = read('Dockerfile').match(/CMD \[[^\]]*"(scripts\/[\w.-]+\.ts)"\]/)
    expect(cmd, 'CMD миграции в Dockerfile не найден').not.toBeNull()
    const entry = cmd![1]
    expect(existsSync(new URL(`../../${entry}`, import.meta.url)), `${entry} не существует`).toBe(true)
    expect(read(entry)).toMatch(/^\s{0,2}main\(\)/m)
  })
})
