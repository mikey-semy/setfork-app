import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ОТЧЁТ О ПРОГОНЕ НЕ ПРАВИТСЯ И НЕ УДАЛЯЕТСЯ.
 *
 * История прогонов и есть «непрерывная перепроверка», ради которой всё затевалось.
 * Правка отчёта задним числом превращает её в рассказ о прошлом: сегодня «работает»,
 * завтра поправили — и уже не узнать, что видел тот, кто отчёту поверил.
 *
 * ⚠️ ПРОВЕРЯЕТСЯ ЗАПРЕТ, А НЕ ОТСУТСТВИЕ. «UPDATE-пути сегодня нет» и «UPDATE-путь
 * запрещён» — разные утверждения: первое верно ровно до следующей задачи, где кому-то
 * покажется удобным «просто дописать вердикт». Инвариант без сторожа нарушают молча.
 *
 * Матч точечный по `verificationReports`: другие таблицы правятся законно, и общий
 * запрет на update сломал бы половину продукта.
 */
const SRC = new URL('../../src', import.meta.url).pathname
const FORBIDDEN = /\.(update|delete)\(\s*verificationReports\s*\)|update\(verificationReports\)|delete\(verificationReports\)/

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

describe('отчёты о прогоне — только добавление', () => {
  it('в коде нет ни update, ни delete по таблице отчётов', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
        if (FORBIDDEN.test(line)) offenders.push(`${file.slice(file.indexOf('src/'))}:${i + 1}`)
      }
    }
    expect(offenders, 'новый прогон добавляет запись; править прежнюю нельзя').toEqual([])
  })
})
