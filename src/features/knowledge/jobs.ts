import 'server-only'

/** Рудник знаний: фоновое извлечение троек (HQ §5). Самоперепланируется в finally — как садовник. */
export async function runTriplesJob(): Promise<void> {
  const { runTriplesSweep, updateGnomeMemories, ensureTriplesScheduled } = await import('./service')
  try {
    await runTriplesSweep()
    // Память гномов — той же суточной джобой (HQ §3 этап 2), максимум 2 гнома за прогон.
    await updateGnomeMemories().catch(() => {})
  } finally {
    await ensureTriplesScheduled()
  }
}
