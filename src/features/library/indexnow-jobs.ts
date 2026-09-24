import 'server-only'

/** IndexNow: проход по новым версиям публичных списков. Самоперепланируется в finally —
 *  как linkcheck: упавший проход не должен остановить петлю. */
export async function runIndexNowJob(): Promise<void> {
  const { runIndexNowPass, ensureIndexNowScheduled } = await import('./indexnow')
  try {
    await runIndexNowPass()
  } finally {
    await ensureIndexNowScheduled()
  }
}
