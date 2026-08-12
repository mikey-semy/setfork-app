'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, type LocaleText } from '@/shared/i18n'
import { listQuota } from '@/shared/quota'
import { notify } from '@/features/notifications/notify'
import { canViewList } from '@/core'
import { listStore } from '../list-store'
import { slugify } from '../slug'
import { enqueueReindex } from '../jobs'
import { withPrDefaults, PR_BOOL_KEYS, type PrBoolKey } from '../pr-settings'

/**
 * Копии чужого списка: форк (со связью с оригиналом) и «использовать как шаблон»
 * (копия без связи), плюс настройки, которые копирование включают.
 *
 * Своя причина меняться: правила именования копии, квоты и то, что именно
 * переносится из оригинала.
 */

// ── Форк ──────────────────────────────────────────────────────────────
// ── «Use this template»: копия списка БЕЗ fork-связи ─────────────────
export async function setListTemplate(templateId: string, isTemplate: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ isTemplate }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

/**
 * Признак «живой список» (лента). Меняет не вид, а правила: у планки свежесть вместо полноты,
 * никакого «устоялся» и расхождения форком, уход ДОБАВЛЯЕТ новое по теме вместо полировки.
 *
 * Ставит и снимает ЧЕЛОВЕК: список, выросший из события, петля помечает живым сама — но это
 * догадка, и снять её должно быть так же просто, как поставить.
 */
export async function setListLiving(templateId: string, living: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ living }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

// Владелец включает/выключает опциональные разделы списка (Issues/Discussions).
// Suggestions — ядро fork-модели, не отключается. Выключенный раздел прячется из
// шапки, а его роуты отдают notFound (гейт на самих страницах).
export async function setListFeatures(templateId: string, feature: 'issues' | 'discussions', on: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const patch = feature === 'issues' ? { issuesEnabled: on } : { discussionsEnabled: on }
  await db.update(templates).set(patch).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

/** Создать свой список на основе шаблона: копия текущей версии, origin
 *  authored, без forked_from (в этом отличие от форка). */
export async function useTemplate(templateId: string): Promise<void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  // Только помеченные шаблоном и видимые (публичные или свои).
  if (!src || !src.isTemplate) return
  if (src.visibility === 'private' && src.ownerId !== session.userId) return
  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/${session.handle}?e=list_quota`)

  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, src.slug)))
  const slug = owned.length ? `${src.slug}-copy` : src.slug

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const srcSteps = srcCurrent
    ? await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    : []
  const created = await listStore.create({
    ownerId: session.userId,
    slug,
    title: src.title,
    desc: src.desc,
    tags: src.tags,
    ordered: src.ordered,
    visibility: 'public',
    status: 'published',
    origin: 'authored', // шаблон — стартовая точка, не fork-связь
    forkedFromId: null,
    note: `from template ${src.slug}`,
    steps: srcSteps.map((s, i) => ({
      n: i + 1,
      type: s.type ?? 'step', // блочная модель: копия не должна терять text/image блоки
      content: s.content ?? {},
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      imageRef: s.imageKey ?? null,
    })),
  })
  // Копия публикуется — но состояние публикации ей задал фасад create, до записи.
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}/${slug}`)
}

export type ForkResult = { error?: string }

/** Статус имени будущего форка для диалога (как «EcoPlay is available ✓» на GitHub):
 *  нормализованный slug + свободно ли оно в пространстве текущего пользователя. */
export async function forkNameStatus(name: string): Promise<{ slug: string; available: boolean }> {
  const session = await requireSession()
  const slug = slugify(name)
  const [taken] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
    .limit(1)
  return { slug, available: !taken }
}

/** Форк списка = «Create a new fork» на GitHub: диалог задаёт имя (по умолчанию slug
 *  источника — у тебя он уникален) и опциональное описание; авто-суффикса `-fork`
 *  больше нет. Свой список форкнуть нельзя (у своих вместо Fork — Pin). */
/**
 * Создание форка с уважением к уникальному индексу «один аккаунт — один форк списка».
 * Нарушение индекса означает, что параллельный запрос уже создал форк: это не ошибка
 * приложения, а нормальный исход гонки, и вызывающий ведёт человека на существующий.
 * Любая другая ошибка пробрасывается — глушить неизвестное здесь нельзя.
 */
async function createForkOrNull(input: Parameters<typeof listStore.create>[0]) {
  try {
    return await listStore.create(input)
  } catch (e) {
    // Только НАШ индекс. Общий шаблон «duplicate key» глушил бы и посторонние
    // нарушения — например, столкновение по имени (templates_owner_slug), когда два
    // форка РАЗНЫХ источников выбрали одинаковое имя. Тогда форка текущего источника
    // не существует, и настоящая ошибка превратилась бы в «попробуйте ещё раз».
    const text = e instanceof Error ? e.message : String(e)
    if (/templates_owner_fork_uq/i.test(text)) return null
    throw e
  }
}

export async function forkTemplate(templateId: string, opts?: { name?: string; description?: string }): Promise<ForkResult | void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!src) return { error: t('forkSourceMissing', await getLang()) }
  // Нельзя форкнуть собственный список (как на GitHub свой репозиторий не форкается).
  if (src.ownerId === session.userId) return { error: t('cantForkOwn', await getLang()) }
  // Видимость: форк раскрывает ВСЁ содержимое (шаги/команды) — чужой приватный/скрытый
  // модерацией форкнуть нельзя (иначе любой залогиненный склонировал бы приватку по id).
  if (!canViewList(src, { isOwner: false })) return { error: t('forkSourceUnavailable', await getLang()) }

  // Дедуп: один аккаунт = один форк списка (как личный аккаунт GitHub) → ведём на существующий.
  const [existingFork] = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.forkedFromId, src.id)))
    .limit(1)
  if (existingFork) redirect(`/${session.handle}/${existingFork.slug}`)

  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/${session.handle}?e=list_quota`)

  // Имя из диалога → slug (по умолчанию slug источника). Авто-суффикса нет: занятое имя = ошибка
  // (диалог проверяет доступность вживую через forkNameStatus, сервер валидирует ещё раз).
  const slug = slugify(opts?.name?.trim() || src.slug)
  const [taken] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
    .limit(1)
  if (taken) return { error: t('forkTaken', await getLang()) }

  // Описание из диалога (опц.) переопределяет на языке зрителя; пустое — наследуем от источника.
  const descOverride = opts?.description?.trim()
  const desc = descOverride ? { ...((src.desc as LocaleText | null) ?? {}), [await getLang()]: descOverride } : src.desc

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const srcSteps = srcCurrent
    ? await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    : []
  // Инвариант «один форк» держит уникальный индекс в БД, а проверка выше лишь
  // экономит работу. Проигравший гонку получает не ошибку, а свой уже созданный форк.
  const created = await createForkOrNull({
    ownerId: session.userId,
    slug,
    title: src.title,
    desc,
    tags: src.tags,
    ordered: src.ordered,
    visibility: src.visibility,
    status: 'published',
    origin: 'forked',
    forkedFromId: src.id,
    note: `forked from ${src.slug} v${srcCurrent?.version ?? 1}`,
    steps: srcSteps.map((s, i) => ({
      n: i + 1,
      type: s.type ?? 'step', // блочная модель: копия не должна терять text/image блоки
      content: s.content ?? {},
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      imageRef: s.imageKey ?? null,
      // Пометка «здесь нужен человек» и её вопрос — часть шага, а не украшение. Шаг,
      // про который автор честно сказал «этого я знать не могу, проверь у себя», после
      // копирования выглядел обычным утверждением — при том что копия наследует ЧУЖОЙ
      // опыт, и теряется ровно та отметка, которая от этого и защищает.
      needsHuman: s.needsHuman,
      needsHumanAsk: s.needsHumanAsk,
      // Идентичность блока: на ней держатся комментарии к пункту и сравнение с
      // источником. Без неё каждый блок форка выглядит новым, и различие с оригиналом
      // показывает полную замену содержимого вместо реальных отличий.
      blockId: s.blockId,
    })),
  })

  // Гонку проиграли: параллельный запрос уже создал форк этого источника, и уникальный
  // индекс не дал сделать второй. Ведём на существующий — счётчик форков и уведомление
  // при этом НЕ повторяются, иначе одно действие пользователя считалось бы дважды.
  if (!created) {
    const [mine] = await db
      .select({ slug: templates.slug })
      .from(templates)
      .where(and(eq(templates.ownerId, session.userId), eq(templates.forkedFromId, src.id)))
      .limit(1)
    if (mine) redirect(`/${session.handle}/${mine.slug}`)
    return { error: t('forkFailed', await getLang()) }
  }
  const forked = created

  await db
    .update(templates)
    .set({ forksCount: sql`${templates.forksCount} + 1` })
    .where(eq(templates.id, src.id))
  await notify({ recipientId: src.ownerId, actorId: session.userId, type: 'fork', templateId: src.id })
  // Форк — тоже публикация, и его состояние решено фасадом create ДО записи: публичный
  // форк недоверенного автора рождается pending, а не «догоняется» апдейтом после.
  await enqueueReindex(forked.id)

  revalidatePath('/explore')
  redirect(`/${session.handle}/${slug}`)
}

/** Переключить флаг настроек предложений (владелец списка). */
export async function setPrSetting(templateId: string, key: PrBoolKey, on: boolean): Promise<void> {
  const session = await requireSession()
  if (!PR_BOOL_KEYS.includes(key)) return
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const next = { ...withPrDefaults(tpl.prSettings), [key]: on }
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

/** Сколько одобрений нужно (0 = не требуются) и кто может предлагать. */
export async function setPrNumber(templateId: string, key: 'requiredApprovals', value: number): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId || key !== 'requiredApprovals') return
  const next = withPrDefaults({ ...withPrDefaults(tpl.prSettings), requiredApprovals: value })
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function setPrMergeMethod(templateId: string, value: 'merge' | 'squash'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const next = withPrDefaults({ ...withPrDefaults(tpl.prSettings), mergeMethod: value })
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function setPrAllowFrom(templateId: string, value: 'all' | 'collaborators'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const next = withPrDefaults({ ...withPrDefaults(tpl.prSettings), allowFrom: value })
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}
