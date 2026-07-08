// Интеграционные тесты обязаны иметь реальную БД. Падаем рано и понятно, если её нет
// (иначе db-модуль позже упадёт невнятно на первом запросе).
if (!process.env.DATABASE_URL) {
  throw new Error(
    'test:integration требует DATABASE_URL (реальный Postgres). Локально: docker + drizzle-kit push, затем DATABASE_URL=... npm run test:integration',
  )
}
