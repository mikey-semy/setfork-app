import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Интеграционные тесты data-layer (tests/**/*.itest.ts) — против РЕАЛЬНОГО Postgres
// (DATABASE_URL). Отделены от юнитов (те в tests/**/*.test.*): `npm run test` их НЕ
// подхватывает, `npm run test:integration` — только их. node-окружение (БД/Redis, не DOM),
// последовательно (общая БД, seed/truncate) — fileParallelism:false.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.itest.ts'],
    setupFiles: ['./tests/integration-setup.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    // Тесты ходят в РЕАЛЬНУЮ базу, а в CI ещё и под инструментацией покрытия и на раннере,
    // где параллельно идут другие прогоны. Дефолтные 5с там не про логику, а про соседей:
    // один и тот же тест то зелёный, то «timed out» — и это уже дважды стоило перезапусков
    // (near-dup-check в integration и в coverage). Ставим честный потолок один раз здесь,
    // а не расставляем магические числа по файлам.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)),
    },
  },
})
