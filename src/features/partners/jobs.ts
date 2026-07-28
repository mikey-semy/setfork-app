import 'server-only'

/** Тонкая обёртка для composition root: сам сервис тянется лениво. */
export async function runPartnersJob(): Promise<void> {
  const { runPartnersJob: run } = await import('./service')
  await run()
}
