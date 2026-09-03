import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { failureReason, fetchAuditReport, highOrCritical, looksLikeReport } from '../../scripts/lib/audit-report.mjs'

/**
 * ДВА РАЗНЫХ КРАСНЫХ: «нашли уязвимость» и «не смогли спросить».
 *
 * `npm audit` возвращает ненулевой код в обоих случаях, и гейт краснел от недоступности
 * реестра — дважды за сутки 02–03.09.2026, оба раза при «found 0 vulnerabilities».
 *
 * ⚠️ ГЛАВНОЕ, ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ, — ЧТО РАЗДЕЛЕНИЕ НЕ ПРЕВРАТИЛОСЬ В «АУДИТ БОЛЬШЕ НЕ
 * БЛОКИРУЕТ». Находка обязана валить джобу по-прежнему; послабление касается ровно
 * одного случая — когда отчёта нет вовсе.
 */
const report = (vulns: Record<string, { severity: string; name: string }>) =>
  JSON.stringify({ vulnerabilities: vulns, metadata: { vulnerabilities: {} } })

const outage = JSON.stringify({ message: 'registry returned 503', statusCode: 503 })

describe('отчёт аудита', () => {
  it('операционный сбой не считается отчётом: «пусто» ≠ «чисто»', () => {
    expect(looksLikeReport(JSON.parse(outage))).toBe(false)
    expect(looksLikeReport(JSON.parse(report({})))).toBe(true)
  })

  it('повторяет запрос: разовый сбой реестра лечится вторым заходом', () => {
    const run = vi.fn().mockReturnValueOnce(outage).mockReturnValueOnce(report({}))
    const r = fetchAuditReport({ run, sleep: () => {} })
    expect(run).toHaveBeenCalledTimes(2)
    expect(r.ok).toBe(true)
  })

  it('сдаётся не сразу, а после трёх попыток — и называет причину', () => {
    const run = vi.fn().mockReturnValue(outage)
    const r = fetchAuditReport({ run, sleep: () => {} })
    expect(run).toHaveBeenCalledTimes(3)
    expect(r.ok).toBe(false)
    expect(r.why).toContain('503')
  })

  it('причина сбоя читается и из пустого вывода', () => {
    expect(failureReason(null, '')).toBe('пустой вывод')
    expect(failureReason(null, 'что-то не то')).toContain('что-то не то')
  })

  it('⚠️ пустой summary не выдаётся за причину', () => {
    // npm печатает {"error":{"code":…,"summary":"","detail":""}} — и на живом прогоне с
    // недоступным реестром в логе выходило «не отдал отчёт ()»: сообщение есть, причины
    // нет. Берём первое НЕПУСТОЕ поле, а не первое не-undefined.
    expect(failureReason({ error: { summary: '', detail: '', code: 'EAUDITNOPJSON' } }, '')).toBe('EAUDITNOPJSON')
    expect(failureReason({ error: { summary: '   ', detail: 'endpoint returned an error' } }, '')).toBe(
      'endpoint returned an error',
    )
  })

  it('находки отбираются по уровню, а при списке пакетов — и по нему', () => {
    const r = JSON.parse(
      report({
        a: { severity: 'high', name: 'a' },
        b: { severity: 'moderate', name: 'b' },
        c: { severity: 'critical', name: 'c' },
      }),
    )
    expect(highOrCritical(r).map((v: { name: string }) => v.name)).toEqual(['a', 'c'])
    expect(highOrCritical(r, new Set(['c'])).map((v: { name: string }) => v.name)).toEqual(['c'])
  })
})

describe('блокирующая половина осталась настоящей', () => {
  const src = (p: string) => readFileSync(new URL('../../' + p, import.meta.url).pathname, 'utf8')

  for (const script of ['scripts/audit-prod-deps.mjs', 'scripts/audit-migrate-deps.mjs']) {
    it(`${script}: находка валит джобу, недоступность — только предупреждает`, () => {
      const text = src(script)
      // Находка → ::error:: и ненулевой выход.
      expect(text).toMatch(/::error::/)
      expect(text).toMatch(/process\.exit\(1\)/)
      // Недоступность → ::warning:: и нулевой выход, но с прямым «НЕ отработал».
      expect(text).toMatch(/::warning::/)
      expect(text, 'предупреждение обязано говорить, что проверка не отработала').toMatch(/НЕ отработал/)
    })
  }

  it('воркфлоу зовёт оба гейта и называет их блокирующими', () => {
    const yml = src('.github/workflows/audit.yml')
    expect(yml).toMatch(/node scripts\/audit-prod-deps\.mjs/)
    expect(yml).toMatch(/node scripts\/audit-migrate-deps\.mjs/)
    // ⚠️ Прямой `npm audit --audit-level` в блокирующем шаге вернул бы прежнее смешение
    // двух красных: код возврата у него один на находку и на сбой.
    const blocking = yml.slice(0, yml.indexOf('Dev-зависимости (не блокирует)'))
    expect(blocking, 'блокирующие шаги не должны звать npm audit напрямую').not.toMatch(/run:\s*npm audit/)
  })
})
