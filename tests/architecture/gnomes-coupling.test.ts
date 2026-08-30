import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * СВЯЗНОСТЬ С ГНОМАМИ НЕ РАСТЁТ — ХРАПОВИК, А НЕ ЗАПРЕТ.
 *
 * Спор «выносить ли гномов из продукта» шёл словами. Это число — ответ: мало связей,
 * значит вынести дёшево; много — вынос означает переписать половину библиотеки.
 *
 * ⚠️ Число мерит цену изоляции от РАВНЫХ (другие фичи + проводка), а не от всего
 * продукта: доставка в счёт не идёт. Для выноса компании это верная цена, для выноса
 * механики — заниженная. Подробности и как пересчитать — в шапке счётчика.
 *
 * ⚠️ СУЩЕСТВУЮЩИЕ СВЯЗИ НЕ ЧИНИМ. Они и есть замер; чинить их сейчас — стирать данные,
 * ради которых счётчик заведён. Запрещён только РОСТ: пока решение не принято, цена
 * выноса не должна тихо увеличиваться.
 *
 * Число уменьшилось — обнови слепок (`node scripts/gnomes-coupling.mjs --json >
 * gnomes-coupling-baseline.json`): храповик крутится в одну сторону.
 */
const ROOT = new URL('../..', import.meta.url).pathname

describe('связность с гномами', () => {
  it('не превышает зафиксированную', () => {
    const now = JSON.parse(execFileSync('node', ['scripts/gnomes-coupling.mjs', '--json'], { cwd: ROOT, encoding: 'utf8' }))
    const base = JSON.parse(readFileSync(new URL('../../gnomes-coupling-baseline.json', import.meta.url), 'utf8'))

    const added = now.hits.filter((h: string) => !base.hits.includes(h))
    expect(added, 'новая связь с гномами: пока решение о выносе не принято, цена не должна расти').toEqual([])
    expect(now.count).toBeLessThanOrEqual(base.count)
  })
})
