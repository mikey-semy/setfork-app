import 'server-only'

/**
 * Обёртка джобы сбора потока — тонкий модуль, как у остальных петель: composition root
 * (instrumentation) не должен тянуть сервис целиком при регистрации хендлеров.
 */
export async function runFeedPullJob(): Promise<void> {
  const { runFeedPullJob: run } = await import('./service')
  await run()
}
