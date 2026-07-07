import 'server-only'
import type { Lang } from '@/shared/i18n'
import type { NotificationType } from '@/features/notifications/queries'
import { sendNotificationEmail } from '@/features/notifications/email'
import { resolveNotificationDisplay } from '@/features/notifications/display'
import { sendPushToUser } from '@/shared/push/send'
import { addCandidate } from '@/features/generation/service'
import { reindexList } from '@/features/library/reindex'

export interface EmailJobPayload {
  to: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
}

/** Обработчик email-задачи. Бросает исключение при неудаче → воркер сделает ретрай. */
export async function runEmailJob(payload: unknown): Promise<void> {
  const p = payload as EmailJobPayload
  const ok = await sendNotificationEmail(p)
  if (!ok) throw new Error('email not sent (SMTP error)')
}

export interface GenerateJobPayload {
  generationId: string
  userId: string
  query: string
  lang: 'en' | 'ru'
  idx: number
}

/** Обработчик задачи AI-генерации варианта. Бросает при ошибке ИИ → ретрай. */
export async function runGenerateJob(payload: unknown): Promise<void> {
  const p = payload as GenerateJobPayload
  const ok = await addCandidate(p.generationId, p.userId, p.query, p.lang, p.idx)
  if (!ok) throw new Error('generation failed (AI error)')
}

export interface ReindexJobPayload {
  templateId: string
}

/** Переиндексация одного списка (эмбеддинг). Ошибка embedding-API → ретрай с backoff. */
export async function runReindexJob(payload: unknown): Promise<void> {
  const p = payload as ReindexJobPayload
  await reindexList(p.templateId)
}

export interface PushJobPayload {
  userId: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
}

/** Web-push уведомления на подписки пользователя (фоновый браузерный поп-ап). */
export async function runPushJob(payload: unknown): Promise<void> {
  const p = payload as PushJobPayload
  const d = await resolveNotificationDisplay(p)
  await sendPushToUser(p.userId, { title: 'SetFork', body: d.text, url: d.url })
}

/** Недельный дайджест «сохранённое дорожает»: проход по получателям + самоперепланирование.
 *  ensure — в finally: следующий запуск встаёт в очередь даже при сбое прохода
 *  (ретраи текущей джобы дублей не создают — ensure видит pending). */
export async function runDigestJob(): Promise<void> {
  const { runWeeklyDigestSweep, ensureDigestScheduled } = await import('@/features/digest/service')
  try {
    await runWeeklyDigestSweep()
  } finally {
    await ensureDigestScheduled()
  }
}

/** Авто-проверка списка (гейт публикации / пере-проверка после правки).
 *  ИИ недоступен → исключение → ретрай с backoff; детали в runModerateJob. */
export async function runModerateJobHandler(payload: unknown, job: { attempts: number; maxAttempts: number }): Promise<void> {
  const { runModerateJob } = await import('@/features/moderation/moderate-list')
  await runModerateJob(payload, job)
}

/** ИИ-садовник: предлагает улучшения публичных списков обычными правками (PR-модель).
 *  Самоперепланируется в finally — как digest. */
export async function runGardenerJob(): Promise<void> {
  const { runGardenerSweep, ensureGardenerScheduled } = await import('@/features/gardener/service')
  try {
    await runGardenerSweep()
  } finally {
    await ensureGardenerScheduled()
  }
}
