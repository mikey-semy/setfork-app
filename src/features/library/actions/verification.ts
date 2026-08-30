'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, templateVersions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
// eslint-disable-next-line boundaries/dependencies -- права соавтора живут в collab, как и у слияния предложения
import { isCollaborator } from '@/features/collab/queries'
import { recordAudit } from '@/shared/audit'

/**
 * ПОСТАВИТЬ УРОВЕНЬ ПРОВЕРКИ ТЕКУЩЕЙ ВЕРСИИ (решение 0018).
 *
 * Без этой ручки поле мертво: `machine_run` проставит джоба прогона, а всё остальное —
 * человек, который список ПРОВЕРИЛ. Ставит автор или соавтор: проверял тот, кто вёл
 * список, и отдавать это админу значило бы просить его подтверждать чужую работу.
 *
 * ⚠️ УРОВЕНЬ ВСЕГДА ЛОЖИТСЯ НА ТЕКУЩУЮ ВЕРСИЮ, и старые версии не трогаются: уровень —
 * свойство байтов, а не списка. Правка создаёт новую версию, та рождается породой, и
 * сброс получается сам — отдельного кода сброса нет намеренно.
 *
 * ⚠️ ДАТА СТАВИТСЯ ЗДЕСЬ, а не приходит из формы: «когда проверяли» — это когда нажали,
 * и позволить указать её вручную значило бы разрешить датировать проверку задним числом.
 * Окружение (в чём проверяли) наоборот приходит от человека: машина его не знает.
 */
export type SetLevelResult = { ok: true } | { error: 'not-allowed' | 'no-version' }

const HUMAN_LEVELS = ['rock', 'doc_checked', 'cut', 'crystal'] as const
export type HumanLevel = (typeof HUMAN_LEVELS)[number]

export async function setVerificationLevel(
  templateId: string,
  level: HumanLevel,
  env: string,
): Promise<SetLevelResult> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { error: 'not-allowed' }
  // Право то же, что у правки списка: кто ведёт список, тот и отвечает за уровень.
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return { error: 'not-allowed' }
  // `machine_run` человеку недоступен намеренно: его ставит прогон, и поставленный
  // руками он означал бы «машина проверяла», когда машина не проверяла.
  if (!HUMAN_LEVELS.includes(level)) return { error: 'not-allowed' }

  const cleared = level === 'rock'
  const [updated] = await db
    .update(templateVersions)
    .set({
      verificationLevel: level,
      // Снятие уровня стирает и дату с окружением: метка «не проверялось» с датой
      // проверки читалась бы как «проверяли и не получилось».
      verifiedAt: cleared ? null : new Date(),
      verifiedEnv: cleared ? null : env.trim().slice(0, 200) || null,
      verifiedBy: cleared ? null : session.userId,
    })
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.currentVersion)))
    .returning({ id: templateVersions.id })
  // Строки версии может не быть у старых списков — это аномалия данных, и молча
  // отвечать «готово» на неё нельзя: человек решил бы, что уровень проставлен.
  if (!updated) return { error: 'no-version' }

  await recordAudit('list.verify', {
    actorId: session.userId,
    targetType: 'list',
    targetId: tpl.id,
    meta: { verificationLevel: level, version: tpl.currentVersion, env: env.trim().slice(0, 200) },
  })
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath('/explore')
  return { ok: true }
}
