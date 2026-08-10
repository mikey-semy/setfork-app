// Интеграционные тесты обязаны иметь реальную БД. Падаем рано и понятно, если её нет
// (иначе db-модуль позже упадёт невнятно на первом запросе).
if (!process.env.DATABASE_URL) {
  throw new Error(
    'test:integration требует DATABASE_URL (реальный Postgres). Локально: docker + drizzle-kit push, затем DATABASE_URL=... npm run test:integration',
  )
}

// Оборванное соединение не должно ронять весь прогон.
//
// Когда тест прерван по таймауту, его `db.transaction` остаётся висеть с
// выданным из пула клиентом. Очистка следующего файла снимает такой бэкенд
// (`pg_terminate_backend`, см. helpers/reset-db.ts) — и брошенный клиент
// получает FATAL 57P01. Без обработчика node-postgres поднимает его как
// unhandled `error` на объекте Client, а это уже не упавший тест, а убитый
// воркер vitest: оставшиеся файлы просто не выполнятся.
//
// Обработчик на пуле делает такую ошибку ожидаемой: она попадает в лог и на
// этом заканчивается. Живые тесты продолжают идти.
import { getPool } from '@/shared/db'

const note = (e: Error & { code?: string }) => {
  console.warn(`[db] соединение оборвано (${e.code ?? 'без кода'}): ${e.message}`)
}

// Этот файл — `setupFiles`, то есть исполняется перед КАЖДЫМ тестовым файлом, а
// пул один на процесс (`global.__pgPool`). Без отметки обработчики копились бы по
// штуке на файл — 84 подписки на одно событие, предупреждение о превышении лимита
// слушателей и медленно растущая утечка.
const pool = getPool() as ReturnType<typeof getPool> & { __sfTestErrorHandlers?: true }
if (!pool.__sfTestErrorHandlers) {
  pool.__sfTestErrorHandlers = true
  // Два обработчика, потому что ошибка приходит в разные места:
  // `pool.on('error')` — только для клиентов, ЛЕЖАЩИХ в пуле; клиент, выданный в
  // работу (а брошенная транзакция держит именно такой), поднимает ошибку на себе.
  // Без второго vitest считает её unhandled и краснит прогон — проверено пробой:
  // снятие своего же бэкенда дало «Vitest caught 2 unhandled errors».
  pool.on('error', note)
  pool.on('connect', (client) => {
    client.on('error', note)
  })
}
