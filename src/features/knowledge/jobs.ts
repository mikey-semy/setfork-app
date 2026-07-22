import 'server-only'

/** Рудник знаний: фоновое извлечение троек (HQ §5). Самоперепланируется в finally — как садовник. */
export async function runTriplesJob(): Promise<void> {
  const { runTriplesSweep, ensureTriplesScheduled } = await import('./service')
  try {
    await runTriplesSweep()
  } finally {
    await ensureTriplesScheduled()
  }
}
