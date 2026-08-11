'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, suggestions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { rateLimit } from '@/shared/rate-limit'
import { toStepInput } from '@/shared/lib/step-input'
import { notify, notifyMentions } from '@/features/notifications/notify'
import { ensureWatch } from '@/features/watch/actions'
import { isCollaborator } from '@/features/collab/queries'
import { collabStore } from '@/features/collab-store/store'
import { canEditList, canViewList, editBlockReason } from '@/core'
import { parseEditorItems, toProposedItems } from '../editor'
import { applySuggestion } from '../suggestion-core'
import { ownerHandle } from './shared'
import { withPrDefaults } from '../pr-settings'

/**
 * Судьба предложения целиком: подать, принять, отклонить, переименовать.
 *
 * Причина измениться одна — правила, по которым чужая правка попадает в очередь и
 * уходит из неё. Как она устроена внутри (ветка, пункты, обсуждение) живёт рядом,
 * в соседних файлах зоны.
 */

// ── Предложить правку (PR) ────────────────────────────────────────────
export async function submitSuggestion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([getLang(), db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })])
  if (!tpl) return
  // Нельзя предлагать правки к приватному/скрытому списку, которого не видишь
  // (иначе — запись в чужую очередь + пинг владельцу + оракул существования).
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return
  // Архив/заморозка: предложения запрещены в обоих состояниях (список только-чтение).
  if (!canEditList(tpl)) redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=${editBlockReason(tpl) ?? 'frozen'}`)
  // Настройка списка «кто может предлагать»: аналог Creation allowed by у GitHub.
  // Владелец может предлагать всегда — иначе он запирал бы сам себя.
  const prs = withPrDefaults(tpl.prSettings)
  if (prs.allowFrom === 'collaborators' && tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) {
    redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=suggest-closed`)
  }
  // Анти-спам: правки — запись в чужую очередь + пинг владельца/упомянутых. Кап на автора.
  if (!(await rateLimit(`suggest:${session.userId}`, 10, 10 * 60_000)).ok) {
    redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/suggestions?e=ratelimited`)
  }

  const note = String(formData.get('note') ?? '').trim()
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  const created = await collabStore.createSuggestion(tpl.id, session.userId, note, toStepInput(proposed))
  await ensureWatch(tpl.id) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  await notifyMentions({ text: note, actorId: session.userId, templateId: tpl.id })

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/suggestions`)
}
export async function acceptSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const res = await applySuggestion(suggestionId, session.userId)
  if (!res.ok) return
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}/${res.slug}`)
}

// ── Обсуждение предложения (review-комментарии) ──────────────────────
/**
 * Переименовать правку (заголовок PR = её сообщение).
 *
 * Право: автор правки или владелец списка — как в GitHub, где заголовок PR
 * правят и автор, и мейнтейнер. Пустой заголовок не принимаем: у правки должно
 * остаться человеческое имя, иначе список PR превращается в «(без описания)».
 */
export async function editSuggestionNote(suggestionId: string, note: string): Promise<{ ok: boolean }> {
  const session = await requireSession()
  const text = note.trim().slice(0, 300)
  if (!text) return { ok: false }

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false }
  if (sug.authorId !== session.userId && sug.template.ownerId !== session.userId) return { ok: false }

  await db.update(suggestions).set({ note: text }).where(eq(suggestions.id, suggestionId))
  const handle = await ownerHandle(sug.template.ownerId)
  revalidatePath(`/${handle}/${sug.template.slug}/suggestions/${sug.number ?? sug.id}`)
  return { ok: true }
}
// ── Автор списка: отклонить предложение ──────────────────────────────
export async function rejectSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || sug.template.ownerId !== session.userId) return

  await db
    .update(suggestions)
    .set({ status: 'rejected', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_rejected', templateId: sug.templateId, suggestionId: sug.id })
  revalidatePath('/', 'layout')
}

// Вход прежний: до разбора все экшены предложений жили здесь, и на этот путь
// напрямую ссылается страница обсуждения. Реэкспорт держит её импорт рабочим —
// разбор не должен заставлять чужую зону переписывать строку импорта.
export { openBranchPr, updateBranchFromMain, mergeBranchPr, resolveBranchPr } from './suggestion-branch'
export { updateSuggestionItems, applySuggestedEdit } from './suggestion-items'
export { addSuggestionComment, editSuggestionComment } from './suggestion-comments'
