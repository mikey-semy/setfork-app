import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Юнит-тесты чистой логики в node. Алиасы: '@'→src; server/client-only → пустышка
// (чтобы можно было тестировать модули, которые их транзитивно тянут).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
    },
  },
})
