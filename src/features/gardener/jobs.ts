import 'server-only'

/** ИИ-садовник: предлагает улучшения публичных списков обычными правками (PR-модель).
 *  Самоперепланируется в finally — как digest.
 *  Динамический import — сервис грузится только когда джоба реально пошла. */
export async function runGardenerJob(): Promise<void> {
  const { runGardenerSweep, ensureGardenerScheduled } = await import('./service')
  try {
    await runGardenerSweep()
  } finally {
    await ensureGardenerScheduled()
  }
}
