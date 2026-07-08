import 'server-only'

/** Авто-проверка списка (гейт публикации / пере-проверка после правки).
 *  ИИ недоступен → исключение → ретрай с backoff; детали в runModerateJob.
 *  Динамический import — сервис грузится только когда джоба реально пошла. */
export async function runModerateJobHandler(
  payload: unknown,
  job: { attempts: number; maxAttempts: number },
): Promise<void> {
  const { runModerateJob } = await import('./moderate-list')
  await runModerateJob(payload, job)
}
