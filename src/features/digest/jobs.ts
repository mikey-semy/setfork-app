import 'server-only'

/** Недельный дайджест «сохранённое дорожает»: проход по получателям + самоперепланирование.
 *  ensure — в finally: следующий запуск встаёт в очередь даже при сбое прохода
 *  (ретраи текущей джобы дублей не создают — ensure видит pending).
 *  Динамический import — сервис грузится только когда джоба реально пошла. */
export async function runDigestJob(): Promise<void> {
  const { runWeeklyDigestSweep, ensureDigestScheduled } = await import('./service')
  try {
    await runWeeklyDigestSweep()
  } finally {
    await ensureDigestScheduled()
  }
}
