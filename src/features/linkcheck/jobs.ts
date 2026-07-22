import 'server-only'

/** Link-checker: проба внешних URL контента чанками с самоцепочкой.
 *  Самоперепланируется в finally — как садовник/digest. Динамический import —
 *  сервис грузится только когда джоба реально пошла. */
export async function runLinkcheckJob(payload: unknown): Promise<void> {
  const { runLinkcheckSweep, ensureLinkcheckScheduled } = await import('./service')
  try {
    const p = (payload ?? {}) as { chained?: boolean }
    await runLinkcheckSweep({ chained: !!p.chained })
  } finally {
    await ensureLinkcheckScheduled()
  }
}
