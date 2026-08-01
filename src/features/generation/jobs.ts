import 'server-only'
import type { Lang } from '@/shared/i18n'
import type { Job } from '@/shared/jobs/queue'
import { abandonGeneration, addCandidate } from './service'

export interface GenerateJobPayload {
  generationId: string
  userId: string
  query: string
  lang: Lang
  idx: number
}

/**
 * Обработчик задачи AI-генерации варианта. Бросает при ошибке ИИ → ретрай.
 *
 * Номер попытки передаём дальше (приём moderate-list): «сорвалось» показываем человеку
 * только когда очередь исчерпала свои попытки. Иначе экран объявлял провал после первой,
 * пока в очереди ещё лежал автоматический повтор, — и кнопка «Ещё раз» ставила ВТОРУЮ
 * задачу параллельно первой: две генерации, двойной расход, два варианта на один запрос.
 */
export async function runGenerateJob(payload: unknown, job: Job): Promise<void> {
  const p = payload as GenerateJobPayload
  const ok = await addCandidate(p.generationId, p.userId, p.query, p.lang, p.idx, {
    final: job.attempts >= job.maxAttempts,
  })
  if (!ok) throw new Error('generation failed (AI error)')
}

/**
 * Задача умерла окончательно — закрываем генерацию.
 *
 * Штатный провал закрывает сам виток в своём `finally`. Сюда попадает случай, когда до
 * `finally` дело не дошло: процесс убили на деплое или OOM, задачу подобрал reaper и
 * похоронил. Без этого генерация оставалась в 'pending' НАВСЕГДА — экран поллит и показывает
 * работу совета, которой давно нет.
 */
export async function finalizeGenerateJob(payload: unknown): Promise<void> {
  const p = payload as GenerateJobPayload
  if (!p?.generationId) return
  await abandonGeneration(p.generationId, p.idx || 1)
}
