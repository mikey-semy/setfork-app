// Хук старта Next (вызывается один раз при инициализации сервера).
// Валидируем окружение до того, как примем первый запрос — падаем рано и понятно.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { validateEnv } = await import('@/shared/env')
  validateEnv()
  // Фоновый воркер очереди задач (email и т.п.). Idempotent, безопасен между инстансами.
  const { startWorker } = await import('@/shared/jobs/worker')
  startWorker()
}
