'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, templates, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { recordAudit } from '@/shared/audit'
import { getLang } from '@/shared/i18n/server'
import { tr, type LocaleText } from '@/shared/i18n'
import { listQuota } from '@/shared/quota'
import { rateLimit } from '@/shared/rate-limit'
import { textLang } from '@/shared/i18n/detect-text-lang'
import { toStepInput } from '@/shared/lib/step-input'
import { canEditList, editBlockReason } from '@/core'
import { DestructiveCommandError } from '@/core/domain/destructive-command'
import { isCollaborator } from '@/features/collab/queries'
import { gateListPublication, recheckList } from '@/features/moderation/moderate-list'
import { registerTags } from '@/features/tags/service'
import { ensureWatch } from '@/features/watch/actions'
import { parseEditorItems, toProposedItems } from '../editor'
import { getDraft, getVersionSteps } from '../queries'
import { deleteDraft, publishDraftFor, upsertDraft, type PublishResult } from '../draft'
import { listStore } from '../list-store'
import { parseTags, slugify } from '../slug'
import { notifyWatchersNewVersion } from '../suggestion-side-effects'
import { enqueueReindex } from '../jobs'
import { ownerHandle } from './shared'

/**
 * Жизнь содержимого списка: создание, правка метаданных, новая версия, черновик
 * правок к опубликованному, публикация и откат к прошлой версии.
 *
 * Одна причина меняться на весь файл — правила записи версии; предложения чужих
 * правок и настройки списка живут отдельно, хотя и зовут отсюда общее.
 */

// ── Создание списка ───────────────────────────────────────────────────
export async function createTemplate(formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const title = String(formData.get('title') ?? '').trim()
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const visibility = formData.get('visibility') === 'private' ? 'private' : 'public'
  const ordered = formData.get('ordered') !== 'unordered'
  const gated = formData.get('gated') === 'on'
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)
  if (!title) return
  // Квота на число списков (мягкая защита от абьюза; админ без лимита).
  if (!(await listQuota(session.userId, session.handle)).ok) redirect('/new?e=list_quota')

  let slug = slugify(title)
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
  if (owned.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

  // Страж исполняемых команд стоит в фасаде записи и на СОЗДАНИИ тоже. Без разбора
  // отказа человек получил бы общую ошибку серверного действия («что-то пошло не
  // так») вместо объяснения, какой шаг и чем именно не годится.
  let list
  try {
    list = await listStore.create({
      ownerId: session.userId,
      slug,
      title: { [lang]: title },
      desc: desc ? { [lang]: desc } : {},
      tags,
      ordered,
      visibility,
      status: 'published',
      origin: 'authored',
      note: 'initial',
      steps: toStepInput(proposed),
    })
  } catch (e) {
    if (e instanceof DestructiveCommandError) redirect(`/new?blocked=${e.reason}&step=${e.stepIndex}`)
    throw e
  }
  if (gated) await db.update(templates).set({ gated: true }).where(eq(templates.id, list.id)) // course quiz-gate
  await registerTags(tags) // новые теги → в реестр
  await ensureWatch(list.id) // владелец следит за своим списком
  // Гейта публикации здесь больше нет: состояние решено ДО записи и приехало значением
  // вставки (фасад listStore.create), а проверку в очередь ставит тот же фасад.
  await enqueueReindex(list.id) // авто-индексация в поиск (через очередь)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

// ── Владелец: правка метаданных списка (название/описание/теги/порядок) ──
// slug НЕ трогаем — он технический и авто-генерённый, пользователя не касается.
// title/desc меняем в ТЕКУЩЕМ языке интерфейса, значения на других языках сохраняем.
export async function updateListMeta(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return // название обязательно
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const ordered = formData.get('ordered') !== 'unordered'
  await db
    .update(templates)
    .set({
      title: { ...(tpl.title as LocaleText), [lang]: title },
      desc: { ...(tpl.desc as LocaleText), [lang]: desc },
      tags,
      ordered,
      updatedAt: new Date(),
    })
    .where(eq(templates.id, templateId))
  await registerTags(tags)
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

// ── Владелец: сохранить как новую версию ─────────────────────────────
export async function saveNewVersion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([getLang(), db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })])
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  if (!canEditList(tpl)) redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=${editBlockReason(tpl) ?? 'frozen'}`)

  const note = String(formData.get('note') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const ordered = formData.get('ordered') !== 'unordered'
  const gated = formData.get('gated') === 'on'
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  // gated — не канон (надстройка Postgres), обновляется отдельно; а tags/ordered
  // едут ВНУТРИ addVersion (Ф2a-довесок): ядро применяет мету той же транзакцией,
  // что и версию, и канон коммита сразу несёт свежие значения. Отдельный апдейт
  // до RPC оставлял бы мету записанной без версии при сбое вызова.
  await db.update(templates).set({ gated, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  await registerTags(tags)
  // Создание версии = git-коммит + проекция в ядре (доменный порт ListStore).
  // Страж исполняемого выхода стоит в фасаде записи (одна точка на все пути), а
  // здесь — показ причины автору: молчаливый отказ читается как «кнопка не
  // работает», а необработанное исключение — как поломка сайта.
  try {
    await listStore.addVersion(tpl.id, {
      note: note || 'edit',
      steps: toStepInput(proposed),
      authorId: session.userId,
      meta: { tags, ordered },
    })
  } catch (e) {
    if (e instanceof DestructiveCommandError) {
      redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/edit?blocked=${e.reason}&step=${e.stepIndex}`)
    }
    throw e
  }
  // Пере-проверку публичного списка делает фасад listStore.addVersion (барьер) — здесь не дублируем.
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Черновик правок к опубликованному списку ──────────────────────────
/**
 * РАБОЧАЯ КОПИЯ вместо версии на каждую правку (решение владельца 04.08.2026:
 * «из-за одного символа менять версию не хочется»). Правки копятся в черновике
 * сколько угодно раз, а версия создаётся ОДНА — явной публикацией.
 *
 * Черновик у каждого автора свой (владелец, соавторы): общая копия затиралась бы
 * при параллельной работе. base_version запоминает, от чего правили, — если список
 * успел уйти вперёд, публикация об этом скажет, а не перезапишет чужое молча.
 */
export async function saveDraft(templateId: string, formData: FormData): Promise<void> {
  const { tpl, handle } = await upsertDraftFromForm(templateId, formData)
  revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
  redirect(`/${handle}/${tpl.slug}/edit?saved=1`)
}

/**
 * Опубликовать ТО, ЧТО СЕЙЧАС В РЕДАКТОРЕ: сначала сохраняем состав формы в черновик,
 * потом публикуем его. Кнопка публикации живёт в той же форме, что и «сохранить», —
 * иначе она уносила бы предыдущее сохранение, а всё дописанное после него пропадало
 * бы молча (находка self-review).
 */
export async function publishEdits(templateId: string, formData: FormData): Promise<void> {
  await upsertDraftFromForm(templateId, formData)
  await publishDraft(templateId)
}

/** Общая часть: собрать черновик из формы редактора и записать его. */
async function upsertDraftFromForm(templateId: string, formData: FormData) {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([getLang(), db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })])
  if (!tpl) redirect('/')
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) redirect('/')
  if (!canEditList(tpl)) redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=${editBlockReason(tpl) ?? 'frozen'}`)

  const items = toProposedItems(parseEditorItems(formData.get('items')), lang)
  const meta = {
    tags: parseTags(formData.get('tags')),
    ordered: formData.get('ordered') !== 'unordered',
    gated: formData.get('gated') === 'on',
  }
  const note = String(formData.get('note') ?? '').trim()
  const handle = await ownerHandle(tpl.ownerId)
  // Пустой состав в черновике не храним: он подменил бы опубликованный список
  // пустотой в редакторе, а опубликовать его всё равно нельзя.
  if (items.length === 0) {
    await deleteDraft(tpl.id, session.userId)
    redirect(`/${handle}/${tpl.slug}/edit?e=empty`)
  }
  // base_version НЕ переписываем у уже устаревшего черновика: сдвинуть его значит
  // сказать «правки сделаны от свежей версии», а они сделаны от старой — и следующая
  // публикация затёрла бы чужую работу молча. Признак устаревания снимает только
  // осознанный отказ от правок (discardDraft), а не автосохранение.
  await upsertDraft(tpl, session.userId, { items, meta, note })
  return { tpl, handle }
}

/** Убрать черновик и вернуться к опубликованному состоянию. */
export async function discardDraft(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  await deleteDraft(tpl.id, session.userId)
  const handle = await ownerHandle(tpl.ownerId)
  revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
  redirect(`/${handle}/${tpl.slug}`)
}

/**
 * Опубликовать накопленный черновик ОДНОЙ версией. Путь записи тот же, что у
 * обычного сохранения (ListStore.addVersion → git-коммит + проекция), — черновик
 * лишь копил состав, поэтому публикация ничем не отличается от прежней правки.
 *
 * Если список успел уйти вперёд (кто-то опубликовал версию, пока правки лежали в
 * черновике), публикацию не делаем: молча перезаписать чужую работу хуже, чем
 * попросить перечитать. Автор увидит это на странице редактора.
 */
export async function publishDraft(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  const handle = await ownerHandle(tpl.ownerId)
  if (!canEditList(tpl)) redirect(`/${handle}/${tpl.slug}?e=${editBlockReason(tpl) ?? 'frozen'}`)

  // Теги черновика — в реестр (иначе новый тег не появится в каталоге и подсказках).
  const pending = await getDraft(tpl.id, session.userId)
  if (pending?.meta.tags?.length) await registerTags(pending.meta.tags)
  let res: PublishResult
  try {
    res = await publishDraftFor(tpl, session.userId)
  } catch (e) {
    // Запрещённая команда — показываем автору причину и номер шага, как при
    // обычном сохранении: молчаливый отказ читается как «кнопка не работает».
    if (e instanceof DestructiveCommandError) redirect(`/${handle}/${tpl.slug}/edit?blocked=${e.reason}&step=${e.stepIndex}`)
    throw e
  }
  // Причины РАЗНЫЕ: «нечего публиковать» и «черновик опустел» — разные сообщения,
  // иначе человек читает про удаление, которого не было.
  if ('error' in res) {
    const reason = res.error === 'stale' ? 'stale' : res.error === 'empty' ? 'empty' : 'nodraft'
    redirect(`/${handle}/${tpl.slug}/edit?e=${reason}`)
  }

  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)
  revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
  redirect(`/${handle}/${tpl.slug}`)
}

// ── Возврат к прошлой версии ──────────────────────────────────────────
/**
 * «Вернуть эту версию» — семантика revert из GitHub: содержимое версии N
 * копируется в НОВУЮ версию N+1, история не переписывается и не теряется
 * (откат самого отката тоже возможен). Идёт через ListStore.addVersion —
 * тот же путь, что у обычного сохранения, включая запись в git.
 */
export async function revertToVersion(templateId: string, version: number): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  // Возвращать можно только к существующей ПРОШЛОЙ версии (текущая — не откат).
  if (!Number.isInteger(version) || version < 1 || version >= tpl.currentVersion) return

  const snap = await getVersionSteps(tpl.id, version)
  if (!snap) return

  await listStore.addVersion(tpl.id, {
    note: `revert to v${version}`,
    steps: toStepInput(snap.steps as unknown as ProposedItem[]),
    authorId: session.userId,
  })
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)

  const handle = await ownerHandle(tpl.ownerId)
  revalidatePath(`/${handle}/${tpl.slug}`)
  revalidatePath(`/${handle}/${tpl.slug}/versions`)
  redirect(`/${handle}/${tpl.slug}`)
}

// ── Публикация черновика (draft → published) ─────────────────────────
export async function publishList(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId || tpl.status !== 'draft') return

  await db.update(templates).set({ status: 'published', updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  // Публикуем публичный список → гейт: pending до авто-проверки (приватный не трогаем).
  if (tpl.visibility === 'public') await gateListPublication(tpl.id)

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}
