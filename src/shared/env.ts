// Проверка окружения при старте (fail-fast). Критичное — без него приложение
// небезопасно/неработоспособно; остальное — фиче-гейтед (OAuth/AI/медиа/git-ядро).

const REQUIRED = ['DATABASE_URL', 'AUTH_SECRET'] as const

/**
 * Числовая настройка из env с ПРЕДСКАЗУЕМЫМ поведением на мусоре.
 *
 * `Number(process.env.X ?? d)` ведёт себя противоположно в соседних константах: у денежного
 * дневного капа `NaN > 0` === false — кап молча ВЫКЛЮЧАЛСЯ (опечатка «10 usd» снимала
 * единственную страховку от слива счёта), а у месячной квоты `used < NaN` === false — квота,
 * наоборот, закрывалась ВСЕМ. Одна и та же ошибка настройки — два разных исхода, и оба тихие.
 *
 * Здесь правило одно: непонятное значение = «настройки нет» → дефолт + громкое предупреждение.
 * Явный `0` остаётся явным нулём (так выключают кап осознанно), пустая строка = не задано.
 */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    // eslint-disable-next-line no-console
    console.warn(`[env] ${name}=${JSON.stringify(raw)} — не число, беру дефолт ${fallback}`)
    return fallback
  }
  return n
}

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
