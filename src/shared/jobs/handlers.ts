import 'server-only'
import type { Lang } from '@/shared/i18n'
import type { NotificationType } from '@/features/notifications/queries'
import { sendNotificationEmail } from '@/features/notifications/email'
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
