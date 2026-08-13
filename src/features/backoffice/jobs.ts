import 'server-only'

/** Тонкие обёртки для composition root: сервис бэк-офиса тянется лениво. */
export async function runFinanceJob(): Promise<void> {
  const { runFinanceJob: run } = await import('./service')
  await run()
}

export async function runChronicleJob(): Promise<void> {
  const { runChronicleJob: run } = await import('./service')
  await run()
}

export async function runAiWatchJob(): Promise<void> {
  const { runAiWatchJob: run } = await import('./service')
  await run()
}
