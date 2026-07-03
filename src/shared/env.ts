// Проверка окружения при старте (fail-fast). Критичное — без него приложение
// небезопасно/неработоспособно; остальное — фиче-гейтед (OAuth/AI/медиа/git-ядро).

const REQUIRED = ['DATABASE_URL', 'AUTH_SECRET'] as const

export function validateEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim())
  if (missing.length) {
    throw new Error(`[env] Не заданы обязательные переменные: ${missing.join(', ')}. Задайте их перед запуском (см. .env.example).`)
  }
  if (process.env.NODE_ENV === 'production' && (process.env.AUTH_SECRET ?? '').length < 32) {
    throw new Error('[env] AUTH_SECRET слишком короткий для прода — нужно ≥ 32 символов (сгенерируйте случайный).')
  }
  // eslint-disable-next-line no-console
  console.log('[env] ok — DATABASE_URL, AUTH_SECRET присутствуют')
}
