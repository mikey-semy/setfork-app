import 'server-only'

/** Самогенерация: специалист сам пишет черновик списка по своей теме (авто-режим).
 *  В режимах off/manual просыпается и сразу уходит спать, ничего не тратя.
 *  Самоперепланируется в finally — как садовник и дайджест.
 *  Динамический import — сервис грузится только когда джоба реально пошла. */
export async function runSelfGenJob(): Promise<void> {
  const { runSelfGenSweep, ensureSelfGenScheduled } = await import('./selfgen')
  try {
    await runSelfGenSweep()
  } finally {
    await ensureSelfGenScheduled()
  }
}
