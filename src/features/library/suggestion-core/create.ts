// Создание предложения из пунктов. Причина измениться одна: кому и к какому
// списку вообще позволено предлагать правку.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, suggestions } from '@/shared/db'
import { toStepInput } from '@/shared/lib/step-input'
import { canEditList, canViewList } from '@/core'
import { withPrDefaults } from '../pr-settings'
import { rateLimit } from '@/shared/rate-limit'
// eslint-disable-next-line boundaries/dependencies -- подписка автора: доменный порт curation, а не экшен (тот берёт сессию)
import { curationStore } from '@/features/curation/store'
// eslint-disable-next-line boundaries/dependencies -- создание правки через доменный порт collab-store
import { collabStore } from '@/features/collab-store/store'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора живут в collab
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- уведомление владельцу: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'
import { SUGGESTION_NOTE_MAX } from './limits'

/**
 * ЯДРО СОЗДАНИЯ предложения — без сессии и без редиректа.
 *
 * Те же ворота, что у формы: нельзя предлагать к списку, которого не видишь
 * (иначе это запись в чужую очередь плюс оракул существования), нельзя к архиву и
 * заморозке, и настройка «кто может предлагать» действует одинаково для человека и
 * для агента. Кап на автора тоже общий: правка пингует владельца, и агенту эта
 * дверь открыта ровно настолько же.
 */
export async function createSuggestion(
  actorUserId: string,
  templateId: string,
  input: { note: string; items: unknown[] },
): Promise<{ ok: true; id: string; number: number | null } | { ok: false; reason: string }> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { ok: false, reason: 'list not found' }
  const isOwner = tpl.ownerId === actorUserId
  if (!canViewList(tpl, { isOwner, isCollaborator: !isOwner && (await isCollaborator(tpl.id, actorUserId)) })) {
    return { ok: false, reason: 'list not found' } // не подтверждаем существование скрытого
  }
  if (!canEditList(tpl)) return { ok: false, reason: tpl.archivedAt ? 'list is archived' : 'list is frozen' }

  const prs = withPrDefaults(tpl.prSettings)
  if (prs.allowFrom === 'collaborators' && !isOwner && !(await isCollaborator(tpl.id, actorUserId))) {
    return { ok: false, reason: 'this list accepts suggestions from collaborators only' }
  }
  if (!(await rateLimit(`suggest:${actorUserId}`, 10, 10 * 60_000)).ok) return { ok: false, reason: 'rate limited' }

  const note = input.note.trim().slice(0, SUGGESTION_NOTE_MAX)
  const created = await collabStore.createSuggestion(tpl.id, actorUserId, note, toStepInput(input.items as never))
  await curationStore.ensureWatch(tpl.id, actorUserId) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: actorUserId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })

  const [row] = await db.select({ number: suggestions.number }).from(suggestions).where(eq(suggestions.id, created.id)).limit(1)
  return { ok: true, id: created.id, number: row?.number ?? null }
}
