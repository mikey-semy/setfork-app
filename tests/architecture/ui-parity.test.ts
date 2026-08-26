import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ОБЩИЙ МОДУЛЬ ДЕРЖИТСЯ ГЕЙТОМ, А НЕ ПАМЯТЬЮ.
 *
 * Счётчики интерфейса (`scripts/ui-sizes.mjs`, `scripts/ui-parity.mjs`) существуют с
 * 13.08.2026 и до сегодняшнего дня не гонялись НИГДЕ: ни в CI, ни в тестах. Замер
 * 26.08.2026 показал, чем это кончается — сам счётчик размеров ослеп (регулярка
 * обрывалась на `onClick={() => {…}}`, из 19 объявлений высоты он видел 5) и честно
 * печатал «нарушений 0». Правило, которое никто не проверяет, не отличается от
 * правила, которого нет.
 *
 * Поэтому гейт живёт здесь, где и так гоняются тесты, а не отдельной джобой:
 *  • шкала контролов — строгий ноль (исключения названы поимённо внутри счётчика);
 *  • самопал ролей — храповик: расти нельзя, уменьшаться можно.
 *
 * Храповик, а не ноль, потому что долг реальный: 344 места переоткрывают роль руками,
 * и одним заходом это не чинится. Смысл гейта — чтобы 345-го не появилось.
 */

const run = (script: string, args: string[] = []) => {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8' }) }
  } catch (e) {
    const err = e as { status?: number; stdout?: string }
    return { code: err.status ?? 1, out: err.stdout ?? '' }
  }
}

type Baseline = Record<string, Record<string, number>>

describe('единство интерфейса', () => {
  it('высота контрола приходит из шкалы (scripts/ui-sizes.mjs)', () => {
    const { code, out } = run('scripts/ui-sizes.mjs')
    expect(out, out).toMatch(/из них нарушений шкалы: 0/)
    expect(code, out).toBe(0)
  })

  it('роль не переоткрывается руками сверх слепка (scripts/ui-parity.mjs)', () => {
    const { out } = run('scripts/ui-parity.mjs', ['--json'])
    const now = JSON.parse(out) as Baseline
    const base = JSON.parse(readFileSync('ui-parity-baseline.json', 'utf8')) as Baseline

    const grew: string[] = []
    for (const [role, files] of Object.entries(now)) {
      for (const [file, count] of Object.entries(files)) {
        const was = base[role]?.[file] ?? 0
        if (count > was) grew.push(`${role}: ${file} — было ${was}, стало ${count}`)
      }
    }

    expect(
      grew,
      `Роль нарисована руками там, где для неё есть общий модуль (см. вывод node scripts/ui-parity.mjs).\n` +
        `${grew.join('\n')}\n\n` +
        `Если модуля под роль правда нет — заведи его в src/shared/ui и назови в счётчике.\n` +
        `Если место законное и это доказано — обнови слепок ОСОЗНАННО:\n` +
        `  node scripts/ui-parity.mjs --json > ui-parity-baseline.json`,
    ).toEqual([])
  })

  it('слепок не отстаёт от кода: починенное вычеркнуто', () => {
    const { out } = run('scripts/ui-parity.mjs', ['--json'])
    const now = JSON.parse(out) as Baseline
    const base = JSON.parse(readFileSync('ui-parity-baseline.json', 'utf8')) as Baseline

    // Протухший слепок опаснее отсутствующего: он разрешает вернуть в файл ровно тот
    // самопал, который из него только что убрали. Поэтому «стало меньше» — это тоже
    // повод обновить слепок, и тест об этом говорит, а не молчит.
    const stale: string[] = []
    for (const [role, files] of Object.entries(base)) {
      for (const [file, count] of Object.entries(files)) {
        const isNow = now[role]?.[file] ?? 0
        if (isNow < count) stale.push(`${role}: ${file} — в слепке ${count}, в коде ${isNow}`)
      }
    }

    expect(stale, `Стало лучше — усуши слепок:\n  node scripts/ui-parity.mjs --json > ui-parity-baseline.json\n${stale.join('\n')}`).toEqual([])
  })
})
