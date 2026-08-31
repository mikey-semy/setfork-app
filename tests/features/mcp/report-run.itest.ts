import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, runs, templates, templateVersions, users, verificationReports } from '@/shared/db'
import { mcpReportRun } from '@/features/mcp/tools'

/**
 * ИНСТРУМЕНТ ЗАПИСИ ОТЧЁТА — вход для внешнего прогонщика.
 *
 * Песочница живёт ВНЕ прода: исполнять чужие скрипты в прод-контейнере нельзя. Прод
 * получает только результат, и этот инструмент — единственная дверь.
 *
 * Проверяются три отказа, каждый из которых защищает утверждение, а не форму данных:
 * чужой список (отвечает за метку тот, кто список ведёт), прогон другого списка (отчёт
 * рассказывал бы про одну версию, ссылаясь на прогон другой), отсутствующий прогон
 * (отчёт без прогона — заявление, а не факт).
 */
const OWNER = 'rr-owner'
const OTHER = 'rr-other'
const ctx: Record<string, string> = {}

beforeEach(async () => {
  for (const h of [OWNER, OTHER]) await db.delete(users).where(eq(users.handle, h))
  const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: OTHER, name: OTHER }).returning({ id: users.id })
  ctx.owner = o.id
  ctx.other = x.id
})

async function listWithRun(slug: string) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: slug }, currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1 }).returning({ id: templateVersions.id })
  const [r] = await db
    .insert(runs)
    .values({ templateId: t.id, versionId: v.id, version: 1, userId: ctx.owner })
    .returning({ id: runs.id })
  return { templateId: t.id, versionId: v.id, runId: r.id, slug }
}

const payload = (runId: string) => ({
  list: '',
  runId,
  task: 'установить хук и вызвать событие',
  environment: { tool: 'claude-code 2.x' },
  steps: [{ n: 1, status: 'pass' as const }],
  verdict: 'works' as const,
})

describe('report_run', () => {
  it('записывает отчёт и поднимает уровень версии', async () => {
    const { slug, runId, versionId } = await listWithRun('rr-ok')
    const res = await mcpReportRun(ctx.owner, { ...payload(runId), list: `${OWNER}/${slug}` })
    expect(res).toMatchObject({ raisedLevel: true, verdict: 'works' })
    const [row] = await db.select().from(verificationReports).where(eq(verificationReports.versionId, versionId))
    // kind зафиксирован машинным: агент не может выдать машинный прогон за человеческий.
    expect(row.kind).toBe('machine')
    expect(row.runnerId).toBe(ctx.owner)
  })

  it('чужому списку отказывает', async () => {
    const { slug, runId } = await listWithRun('rr-foreign')
    const res = await mcpReportRun(ctx.other, { ...payload(runId), list: `${OWNER}/${slug}` })
    expect(res).toEqual({ error: 'forbidden' })
  })

  it('без существующего прогона отказывает', async () => {
    // Отчёт называется воспроизводимым фактом; без прогона это заявление «я проверил».
    const { slug } = await listWithRun('rr-norun')
    const res = await mcpReportRun(ctx.owner, {
      ...payload('00000000-0000-0000-0000-0000000000aa'),
      list: `${OWNER}/${slug}`,
    })
    expect(res).toMatchObject({ error: expect.stringContaining('run not found') })
  })

  it('прогон ЧУЖОГО списка не годится', async () => {
    // Иначе отчёт рассказывал бы про одну версию, ссылаясь на прогон другой.
    const a = await listWithRun('rr-a')
    const b = await listWithRun('rr-b')
    const res = await mcpReportRun(ctx.owner, { ...payload(b.runId), list: `${OWNER}/${a.slug}` })
    expect(res).toMatchObject({ error: expect.stringContaining('run not found') })
  })

  it('провал записывается и уровень не меняет', async () => {
    const { slug, runId, versionId } = await listWithRun('rr-fail')
    const res = await mcpReportRun(ctx.owner, {
      ...payload(runId),
      list: `${OWNER}/${slug}`,
      verdict: 'fails',
      steps: [{ n: 1, status: 'fail', note: 'нет прав' }],
    })
    expect(res).toMatchObject({ raisedLevel: false, verdict: 'fails' })
    const [v] = await db.select({ l: templateVersions.verificationLevel }).from(templateVersions).where(eq(templateVersions.id, versionId))
    expect(v.l).toBe('rock')
  })
  it('прогон по СТАРОЙ версии принимается — и агент об этом узнаёт', async () => {
    // ⚠️ Отчёт правильно ложится на СВОЮ версию и правильно поднимает её уровень —
    // «отчёт принадлежит версии» цел. Но список за это время мог уйти вперёд: агент
    // прогнал v1, автор внёс правку, и на самом списке не меняется ничего. Запрещать
    // такой отчёт нельзя (он честный), молчать — тоже: агент решил бы, что поручился
    // за текущее состояние. Поэтому сообщаем факт, а решение оставляем ему.
    const { templateId, runId, slug } = await listWithRun('rr-stale')
    // Список уезжает на v2 — как после принятой правки.
    await db.insert(templateVersions).values({ templateId, version: 2 })
    await db.update(templates).set({ currentVersion: 2 }).where(eq(templates.id, templateId))

    const res = await mcpReportRun(ctx.owner, { ...payload(runId), list: `${OWNER}/${slug}` })

    expect('error' in res, 'честный отчёт по старой версии не запрещаем').toBe(false)
    expect(res).toMatchObject({ reportedVersion: 1, currentVersion: 2, staleVersion: true })
    expect((res as { note?: string }).note, 'агенту сказано словами, за что он поручился').toMatch(/v1/)
  })

  it('прогон по текущей версии не помечается устаревшим', async () => {
    const { runId, slug } = await listWithRun('rr-fresh')
    const res = await mcpReportRun(ctx.owner, { ...payload(runId), list: `${OWNER}/${slug}` })
    expect(res).toMatchObject({ reportedVersion: 1, currentVersion: 1 })
    expect('staleVersion' in res, 'лишнего предупреждения быть не должно').toBe(false)
  })
})
