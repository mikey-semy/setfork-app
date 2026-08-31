// Режим ремонта на машинных поверхностях. Для `/raw` это особый случай: его тело
// уходит в интерпретатор, и обычная строка «SetFork is down for maintenance» там —
// не сообщение, а команда (шелл отвечает `SetFork: command not found`). Значит и
// ремонт обязан отвечать заглушкой диалекта. Карточка реестра 014, P1.
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dialectSpec, type ScriptDialect } from '@/core/domain/script-dialect'

vi.mock('@/shared/settings/maintenance', () => ({ maintenanceEnabled: async () => true }))

const { middleware } = await import('@/middleware')

const call = (path: string) => middleware(new NextRequest(new Request(`https://setfork.test${path}`)))

describe('ремонт не отдаёт исполняемого текста в шелл', () => {
  for (const dialect of ['sh', 'ps1', 'py'] as ScriptDialect[]) {
    it(`/raw?lang=${dialect}: 503 заглушкой диалекта, а не строкой текста`, async () => {
      const res = await call(`/alice/deploy/raw?lang=${dialect}`)
      const spec = dialectSpec(dialect)
      expect(res.status).toBe(503)
      expect(res.headers.get('Content-Type')).toBe(spec.mime)
      expect(res.headers.get('SF-Reason')).toBe('maintenance')
      expect(res.headers.get('Retry-After')).toBeTruthy()

      const lines = (await res.text()).split(/\r\n|\r|\n/).filter((l) => l.trim())
      expect(lines.pop()).toBe(spec.fail)
      for (const l of lines) expect(l === spec.shebang || l.startsWith('#'), `исполняемая строка: ${l}`).toBe(true)
    })
  }

  it('остальные машинные поверхности получают прежний text/plain', async () => {
    const res = await call('/api/health-ish')
    expect(res.status).toBe(503)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
  })

  it('страницу человек по-прежнему видит как HTML', async () => {
    const res = await call('/alice/deploy')
    expect(res.status).toBe(503)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })
})

/**
 * ⚠️ `.md`-АДРЕС НЕ ОБХОДИТ РЕМОНТ.
 *
 * Переписывание `/{handle}/{slug}.md` стояло ПЕРЕД проверкой режима — и адрес отдавал
 * 200 с полным содержимым, продолжая ходить в базу ровно тогда, когда режим существует,
 * чтобы база молчала. Машинная поверхность — не повод обходить ремонт: `/raw` и `/api/`
 * его не обходят, и `.md` не должен.
 */
describe('ремонт закрывает и markdown-адрес', () => {
  it('/{handle}/{slug}.md отвечает 503, а не отдаёт список', async () => {
    const res = await call('/alice/deploy.md')
    expect(res.status, 'в ремонте .md обязан молчать, а не отдавать содержимое').toBe(503)
    expect(res.headers.get('SF-Reason')).toBe('maintenance')
  })
})
