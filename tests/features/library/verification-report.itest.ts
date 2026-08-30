import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, templates, templateVersions, users, verificationReports } from '@/shared/db'
import { latestReport, recordVerificationReport } from '@/features/library/verification-report'

/**
 * ОТЧЁТ О ПРОГОНЕ И УРОВЕНЬ ПРОВЕРКИ: что поднимается, что не трогается.
 *
 * Правило спеки: успешный machine-отчёт поднимает версию до «прогнано машиной», но
 * ТОЛЬКО если текущий уровень ниже. Ручной «кристалл» машиной не перетирается — это
 * было бы понижением утверждения: машина проверяет меньше, чем человек. Провал не
 * меняет уровень вовсе, но отчёт пишется: «прогоняли и не вышло» и «не прогоняли» —
 * разные факты, и подменять один другим нельзя.
 */
const OWNER = 'rp-owner'
const ctx: Record<string, string> = {}

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  ctx.owner = u.id
})

async function version(slug: string, level: 'rock' | 'machine_run' | 'crystal') {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: slug }, currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, verificationLevel: level })
    .returning({ id: templateVersions.id })
  return { templateId: t.id, versionId: v.id }
}

const levelOf = async (versionId: string) => {
  const [row] = await db.select({ l: templateVersions.verificationLevel }).from(templateVersions).where(eq(templateVersions.id, versionId))
  return row.l
}

const report = (over: Partial<Parameters<typeof recordVerificationReport>[0]> = {}) => ({
  templateId: '',
  versionId: '',
  kind: 'machine' as const,
  task: 'установить хук и вызвать событие',
  environment: { tool: 'claude-code 2.x', os: 'ubuntu 24.04' },
  steps: [
    { n: 1, status: 'pass' as const },
    { n: 2, status: 'pass' as const },
  ],
  verdict: 'works' as const,
  runnerId: null,
  ...over,
})

describe('отчёт о прогоне и уровень версии', () => {
  it('успешный machine-отчёт поднимает породу до «прогнано машиной»', async () => {
    const { templateId, versionId } = await version('rp-low', 'rock')
    const res = await recordVerificationReport(report({ templateId, versionId }))
    expect(res.raisedLevel).toBe(true)
    expect(await levelOf(versionId)).toBe('machine_run')
  })

  it('ручной «кристалл» машиной НЕ перетирается и не понижается', async () => {
    const { templateId, versionId } = await version('rp-high', 'crystal')
    const res = await recordVerificationReport(report({ templateId, versionId }))
    expect(res.raisedLevel).toBe(false)
    expect(await levelOf(versionId)).toBe('crystal')
    // Отчёт при этом записан: он объясняет метку, а не заменяет её.
    const rows = await db.select().from(verificationReports).where(eq(verificationReports.versionId, versionId))
    expect(rows).toHaveLength(1)
  })

  it('провал уровень не меняет, но отчёт пишется', async () => {
    const { templateId, versionId } = await version('rp-fail', 'rock')
    const res = await recordVerificationReport(
      report({ templateId, versionId, verdict: 'fails', steps: [{ n: 1, status: 'fail', note: 'нет прав' }] }),
    )
    expect(res.raisedLevel).toBe(false)
    expect(await levelOf(versionId)).toBe('rock')
    const last = await latestReport(versionId)
    expect(last?.verdict).toBe('fails')
  })

  it('повторный прогон не дублирует уровень и добавляет запись', async () => {
    const { templateId, versionId } = await version('rp-twice', 'rock')
    await recordVerificationReport(report({ templateId, versionId }))
    const second = await recordVerificationReport(report({ templateId, versionId }))
    expect(second.raisedLevel).toBe(false)
    expect(await levelOf(versionId)).toBe('machine_run')
    const rows = await db.select().from(verificationReports).where(eq(verificationReports.versionId, versionId))
    expect(rows, 'история прогонов — это все прогоны, а не последний').toHaveLength(2)
  })

  it('новая версия не наследует отчётов', async () => {
    // Сброс доверия при правке получается из устройства: отчёт принадлежит версии.
    const { templateId, versionId } = await version('rp-fresh', 'rock')
    await recordVerificationReport(report({ templateId, versionId }))
    const [v2] = await db.insert(templateVersions).values({ templateId, version: 2 }).returning({ id: templateVersions.id })
    expect(await latestReport(v2.id)).toBeNull()
    expect(await levelOf(v2.id)).toBe('rock')
  })
})
