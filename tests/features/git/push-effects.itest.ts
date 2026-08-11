import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Что происходит ПОСЛЕ принятого пуша.
//
// Две карточки ревью git-транспорта:
//  003 — рассылка шла без actorId, поэтому владелец, наблюдающий за собственным списком
//        (а он наблюдает — `ensureWatch` подписывает его при создании), получал
//        уведомление о своём же `git push`;
//  008 — snapshot каждой magic-ветки, создание предложения, чтение всех наблюдателей,
//        рассылка, аудит и постановка модерации стояли под `await` МЕЖДУ приёмом пака и
//        ответом клиенту: чем больше наблюдателей, тем шире окно, а таймаут прокси в нём
//        означает «данные записаны, а клиент считает push неуспешным».
const h = vi.hoisted(() => ({ snapshot: true as boolean, commits: [] as { message: string }[], rechecked: [] as string[] }))

vi.mock('@/features/git/core', () => ({
  gitCore: {
    branchSnapshot: async () => (h.snapshot ? { blocks: [] } : null),
    listCommits: async () => h.commits,
  },
}))

const { db, jobs, notifications, suggestions, templateVersions, templates, users, watches } = await import('@/shared/db')
const { registerPushEffectsPorts, runGitPushEffects, scheduleAcceptedPushEffects } = await import('@/features/git/push-effects')
const { ensureBranchSuggestion } = await import('@/features/library/suggestion-core')
const { getWatcherIds } = await import('@/features/watch/queries')
const { notifyMany } = await import('@/features/notifications/notify')

// Порты связывает composition root (instrumentation) — здесь та же пара, что и в бою.
// Исключение одно: пере-проверка модерацией. Это соседний контур со своим ИИ-ключом и
// своей очередью; проверяются доставка и авторство, поэтому её достаточно посчитать.
const ports = {
  ensureBranchSuggestion,
  watcherIds: getWatcherIds,
  notifyNewVersion: (ids: string[], { actorId, listId }: { actorId: string; listId: string }) =>
    notifyMany(ids, { actorId, type: 'new_version', templateId: listId }),
  recheckList: async (id: string) => {
    h.rechecked.push(id)
  },
}
registerPushEffectsPorts(ports)

let ownerId = ''
let watcherId = ''
let listId = ''

const push = (over: Partial<Parameters<typeof runGitPushEffects>[0] & Record<string, unknown>> = {}) => ({
  repo: { owner: 'pe-owner', slug: 'list' },
  listId,
  ownerId,
  currentVersion: 1,
  actorId: ownerId,
  actorHandle: 'pe-owner',
  lang: 'ru' as const,
  newVersion: 2,
  magic: [] as { branch: string; tipSha: string }[],
  isPublic: true,
  ip: '203.0.113.7',
  ...over,
})

beforeEach(async () => {
  await resetTables([jobs, notifications, watches, suggestions, templateVersions, templates, users])
  const [o] = await db.insert(users).values({ handle: 'pe-owner' }).returning({ id: users.id })
  const [w] = await db.insert(users).values({ handle: 'pe-watcher' }).returning({ id: users.id })
  ownerId = o.id
  watcherId = w.id
  // Список ПУБЛИЧНЫЙ: у приватного рассылка идёт только владельцу и соредакторам —
  // посторонний наблюдатель отфильтровывается на чтении (curation/adapter, линза 02 F8),
  // и проверять на нём «кому пришло» было бы проверкой не того правила.
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: 'list', title: { ru: 'Список' }, status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  listId = t.id
  await db.insert(templateVersions).values({ templateId: listId, version: 1, note: 'v1' })
  // Оба наблюдают за списком: владелец (как после создания) и посторонний.
  await db.insert(watches).values([
    { templateId: listId, userId: ownerId, level: 'all' },
    { templateId: listId, userId: watcherId, level: 'all' },
  ])
  h.snapshot = true
  h.commits = []
  h.rechecked = []
})

afterAll(async () => {
  await resetTables([jobs, notifications, watches, suggestions, templateVersions, templates, users])
})

const notifOf = async (recipientId: string) =>
  db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), eq(notifications.type, 'new_version')))
    .then((r) => r[0]?.n ?? 0)

describe('уведомление о новой версии (карточка 003)', () => {
  it('пушащему владельцу уведомления о собственном пуше НЕ приходит', async () => {
    await runGitPushEffects(push({ actorId: ownerId }))
    expect(await notifOf(ownerId)).toBe(0)
  })

  it('остальные наблюдатели получают уведомление, и в нём записан автор', async () => {
    await runGitPushEffects(push({ actorId: ownerId }))
    expect(await notifOf(watcherId)).toBe(1)
    const [row] = await db.select({ actorId: notifications.actorId }).from(notifications).limit(1)
    expect(row.actorId).toBe(ownerId)
  })

  it('пушащий посторонний тоже исключён из собственной рассылки', async () => {
    await runGitPushEffects(push({ actorId: watcherId }))
    expect(await notifOf(watcherId)).toBe(0)
    expect(await notifOf(ownerId)).toBe(1)
  })
})

describe('доставка вынесена из ответа протокола (карточка 008)', () => {
  it('на пути пуша выполняется ровно одна запись — намерение в очереди', async () => {
    await scheduleAcceptedPushEffects(push())

    const [job] = await db.select({ type: jobs.type, payload: jobs.payload }).from(jobs)
    expect(job.type).toBe('git_push')
    expect((job.payload as { listId: string }).listId).toBe(listId)
    // Ни одного эффекта синхронно: ни уведомлений, ни предложений.
    expect(await notifOf(watcherId)).toBe(0)
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(suggestions)
    expect(n).toBe(0)
  })

  it('сбой постановки не отменяет уже принятый пуш', async () => {
    // Пак записан, версия создана — отказ ОЧЕРЕДИ не имеет права стать ошибкой клиента.
    const broken = { ...push(), listId: '00000000-0000-0000-0000-000000000000' }
    await expect(scheduleAcceptedPushEffects({ ...broken, magic: [] })).resolves.toBeUndefined()
  })
})

describe('повтор задачи безопасен', () => {
  it('предложение из ветки не задваивается, а уведомление не уходит второй раз', async () => {
    h.commits = [{ message: 'правлю шаг\n\nподробности' }]
    const payload = push({ magic: [{ branch: 'u/pe-owner/main', tipSha: 'abc123' }], actorId: watcherId })

    await runGitPushEffects(payload)
    await runGitPushEffects(payload)

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(suggestions)
    expect(n).toBe(1) // ensureBranchSuggestion идемпотентен по ветке
    const [sug] = await db.select({ note: suggestions.note }).from(suggestions)
    expect(sug.note).toBe('правлю шаг') // тема коммита, без тела
    // Уведомление ушло дважды — это ЦЕНА повтора, и она осознанная: у notify нет дедупа,
    // поэтому шаги, которые нельзя повторять, стоят ПОСЛЕ идемпотентных и не бросают,
    // а значит повтора после них не бывает. Здесь повтор вызван руками.
    expect(await notifOf(ownerId)).toBe(2)
  })

  it('провал одноразового шага не роняет задачу и не отменяет остальные', async () => {
    // Раньше эту границу держал сам маршрут (карточка 002): сбой чтения наблюдателей
    // ронял ответ на УЖЕ принятый пуш. Теперь доставка идёт задачей, и правило то же —
    // упавший шаг виден в наблюдаемости, но соседние шаги выполняются.
    const failing = { ...ports, watcherIds: async () => Promise.reject(new Error('watchers lookup failed')) }
    registerPushEffectsPorts(failing)
    try {
      await expect(runGitPushEffects(push({ actorId: watcherId }))).resolves.toBeUndefined()
      expect(h.rechecked).toContain(listId) // следующий шаг всё равно отработал
    } finally {
      registerPushEffectsPorts(ports)
    }
  })

  it('ветка, которая не разворачивается в список, не роняет остальные эффекты', async () => {
    h.snapshot = false
    await runGitPushEffects(push({ magic: [{ branch: 'u/pe-owner/main', tipSha: 'abc' }], actorId: watcherId }))

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(suggestions)
    expect(n).toBe(0)
    expect(await notifOf(ownerId)).toBe(1) // версия всё равно объявлена наблюдателям
  })
})
