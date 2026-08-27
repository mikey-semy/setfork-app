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
 * Храповик стоял, пока долг был реальный: 344 места переоткрывали роль руками, и одним
 * заходом это не чинилось. 27.08.2026 долг дошёл до НУЛЯ, и храповик уступил место
 * строгому нулю — по тому же правилу, что и шкала контролов. Разница принципиальная:
 * храповик разрешает жить с долгом, ноль требует ответа на каждое новое место.
 *
 * Ответов ровно два, и оба явные: либо взять примитив, либо поставить над местом
 * `ui-parity-ok: <причина>` — причина обязательна и не короче 20 знаков. Отметки едут в
 * тот же слепок отдельной строкой и остаются под храповиком: отметка снимает место с
 * долга, то есть обязана быть видна в дифференциале, а не появляться молча.
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

/** Ключ слепка, под которым едут места, снятые отметкой «разобрано и законно». */
const MARKED = 'разобрано и законно'

describe('единство интерфейса', () => {
  it('высота контрола приходит из шкалы (scripts/ui-sizes.mjs)', () => {
    const { code, out } = run('scripts/ui-sizes.mjs')
    expect(out, out).toMatch(/из них нарушений шкалы: 0/)
    expect(code, out).toBe(0)
  })

  it('роль не переоткрывается руками: строгий ноль (scripts/ui-parity.mjs)', () => {
    const { out } = run('scripts/ui-parity.mjs', ['--json'])
    const now = JSON.parse(out) as Baseline

    const debt: string[] = []
    for (const [role, files] of Object.entries(now)) {
      if (role === MARKED) continue
      for (const [file, count] of Object.entries(files)) debt.push(`${role}: ${file} ×${count}`)
    }

    expect(
      debt,
      `Роль нарисована руками там, где для неё есть общий модуль (см. вывод node scripts/ui-parity.mjs).\n` +
        `${debt.join('\n')}\n\n` +
        `Ответов два:\n` +
        `  • взять примитив из src/shared/ui (счётчик называет его рядом с ролью);\n` +
        `  • если примитив тут не годится — сказать это ВСЛУХ над местом:\n` +
        `      // ui-parity-ok: <чем эта роль отличается, не короче 20 знаков>\n` +
        `    и обновить слепок: node scripts/ui-parity.mjs --json > ui-parity-baseline.json\n` +
        `Если модуля под роль правда нет — заведи его в src/shared/ui и назови в счётчике.`,
    ).toEqual([])
  })

  it('отметок «законно» не прибавилось молча', () => {
    const { out } = run('scripts/ui-parity.mjs', ['--json'])
    const now = (JSON.parse(out) as Baseline)[MARKED] ?? {}
    const base = (JSON.parse(readFileSync('ui-parity-baseline.json', 'utf8')) as Baseline)[MARKED] ?? {}

    const grew: string[] = []
    for (const [file, count] of Object.entries(now)) {
      const was = base[file] ?? 0
      if (count > was) grew.push(`${file} — было ${was}, стало ${count}`)
    }

    expect(
      grew,
      `Новая отметка ui-parity-ok. Она снимает место с долга, поэтому обязана быть видна\n` +
        `в дифференциале как осознанный шаг:\n  node scripts/ui-parity.mjs --json > ui-parity-baseline.json\n${grew.join('\n')}`,
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
