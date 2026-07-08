import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Интеграционные тесты data-layer (*.itest.ts) — против РЕАЛЬНОГО Postgres
// (DATABASE_URL). Отделены от юнитов (те в *.test.{ts,tsx}, БД не трогают):
// `npm run test` их НЕ подхватывает, `npm run test:integration` — только их.
// Гоняются последовательно (общая БД, seed/truncate) — fileParallelism:false.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.itest.ts'],
    setupFiles: ['./test/integration-setup.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
    },
  },
})
