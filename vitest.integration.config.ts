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
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)),
    },
  },
})
